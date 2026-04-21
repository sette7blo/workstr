"""
modules/ai_planner.py — AI-generated weekly workout plan from user's own exercise library.
"""
import json
import re
from openai import OpenAI
from core import config
from core.db import db

SYSTEM_PROMPT = """You are a certified personal trainer creating a weekly workout plan.
The user will provide their exercise library, goals, and preferences.
Respond ONLY with a valid JSON object — no preamble, no markdown, raw JSON only.

The plan must be:
{
  "plan": [
    {
      "date": "YYYY-MM-DD",
      "slot": "Morning" | "Afternoon" | "Evening",
      "exercise_slug": "slug-from-library",
      "notes": "optional note e.g. 'Focus on form'"
    },
    ...
  ],
  "summary": "1-2 sentence explanation of the plan"
}

Rules:
- Only use exercises from the provided library (use their exact slugs).
- Respect the requested days_per_week.
- Spread muscle groups appropriately — avoid training the same muscles on consecutive days.
- If the user has equipment preferences, only include exercises matching their available equipment.
- Include rest days. A day with no entries = rest day.
"""


def generate_plan(week_start: str, days_per_week: int = 4,
                  goal: str = "general fitness", equipment_filter: list = None,
                  muscle_focus: list = None) -> dict:
    """
    Generate a 7-day workout plan using the user's exercise library.
    Returns {plan: [...], summary: str}. Raises on error.
    """
    api_key = config.get("PPQ_API_KEY")
    if not api_key:
        raise ValueError("PPQ_API_KEY not configured.")

    base_url = config.get("PPQ_BASE_URL", "https://api.ppq.ai/v1")
    model = config.get("PPQ_MODEL", "gpt-4o-mini")

    # Load active exercises from DB
    with db() as conn:
        rows = conn.execute(
            "SELECT slug, name, category, muscle_group, equipment_list, difficulty FROM exercises WHERE status='active'"
        ).fetchall()

    exercises = []
    for r in rows:
        eq = r["equipment_list"] or "[]"
        try:
            eq_list = json.loads(eq)
        except Exception:
            eq_list = []
        if equipment_filter:
            if not any(e.lower() in [x.lower() for x in equipment_filter] for e in eq_list):
                continue
        exercises.append({
            "slug": r["slug"],
            "name": r["name"],
            "category": r["category"],
            "muscle_group": r["muscle_group"],
            "difficulty": r["difficulty"],
        })

    if not exercises:
        raise ValueError("No exercises in your library match the selected criteria.")

    from datetime import date, timedelta
    start = date.fromisoformat(week_start)
    dates = [(start + timedelta(days=i)).isoformat() for i in range(7)]

    user_prompt = f"""Create a {days_per_week}-day workout plan for the week of {week_start}.
Goal: {goal}
{f'Muscle focus: {", ".join(muscle_focus)}' if muscle_focus else ''}

Available exercises:
{json.dumps(exercises, indent=2)}

Week dates: {", ".join(dates)}

Return a plan using only exercises from the list above, spread across {days_per_week} of the 7 days."""

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.6,
        max_tokens=2000,
    )

    content = response.choices[0].message.content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    return json.loads(content)
