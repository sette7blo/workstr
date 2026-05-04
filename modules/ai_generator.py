"""
modules/ai_generator.py — PPQ.ai → structured exercise JSON
Generated exercises land in 'staged' status for user approval.
"""
import json
import re
import urllib.request
from pathlib import Path
from openai import OpenAI
from core import config
from core.db import db
from modules.importer import save_exercise_json, slugify

IMAGES_DIR = Path(__file__).parent.parent / "images"

SYSTEM_PROMPT = """You are a certified personal trainer and exercise scientist.
When given an exercise request, respond ONLY with a valid JSON object.
No preamble, no explanation, no markdown — raw JSON only.

Required fields:
- name: string (full exercise name)
- slug: url-friendly version of name (lowercase, hyphens)
- description: 2-3 sentence description of the exercise and its benefits
- category: one of "strength", "cardio", "flexibility", "balance", "plyometrics"
- muscle_group: primary muscle group (e.g. "Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Full Body")
- muscles: array of muscles targeted (primary first, then secondary — e.g. ["Pectorals", "Anterior Deltoid", "Triceps"])
- equipment: array of required equipment (e.g. ["Barbell", "Flat Bench"]) — use ["Body Weight"] if none needed
- difficulty: one of "beginner", "intermediate", "advanced"
- tags: array of relevant tags (e.g. ["compound", "push", "upper body"])
- instructions: array of plain strings, each a single clear step
- default_sets: integer (typical number of sets, e.g. 3)
- default_reps: string (rep range or duration, e.g. "8-12" or "30 seconds")
- default_rest_sec: integer (rest between sets in seconds, e.g. 90)
- source_type: "ai"
"""


def generate_exercise(prompt: str) -> dict:
    """
    Generate an exercise from a natural language prompt.
    Returns the exercise dict saved as staged JSON. Raises on error.
    """
    api_key = config.get("PPQ_API_KEY")
    if not api_key:
        raise ValueError("PPQ_API_KEY not configured. Add it in Settings.")

    base_url = config.get("PPQ_BASE_URL", "https://api.ppq.ai/v1")
    model = config.get("PPQ_MODEL", "gpt-4o-mini")

    equipment_setting = config.get("EQUIPMENT", "").strip()
    full_prompt = prompt
    if equipment_setting:
        full_prompt += f"\n\nAvailable equipment: {equipment_setting}. Only include exercises doable with this equipment."

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": full_prompt}
        ],
        temperature=0.7,
        max_tokens=1500,
    )
    content = response.choices[0].message.content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    data = json.loads(content)

    if "slug" not in data or not data["slug"]:
        data["slug"] = slugify(data.get("name", "exercise"))

    # Generate image (best-effort — never blocks save)
    slug = data["slug"]
    image_model = config.get("PPQ_IMAGE_MODEL", "dall-e-3")
    image_path = _generate_image(data, slug, api_key, base_url, image_model)
    if image_path:
        data["image"] = f"images/{image_path.name}"

    path = save_exercise_json(data, status="staged")

    if image_path and path:
        with db() as conn:
            conn.execute(
                "UPDATE exercises SET image_url=?, updated_at=datetime('now') WHERE slug=?",
                (data["image"], slug)
            )

    return data


def _generate_image(data: dict, slug: str, api_key: str, base_url: str, model: str) -> Path | None:
    IMAGES_DIR.mkdir(exist_ok=True)
    dest = IMAGES_DIR / f"{slug}.png"

    name = data.get("name", "exercise")
    equipment = data.get("equipment", [])
    equip_str = ", ".join(equipment) if equipment else ""
    prompt = (
        f"A single photo of an athlete performing {name}"
        + (f" using {equip_str}" if equip_str and equip_str != "Body Weight" else "")
        + " in a gym. Mid-action pose, athletic wear, clean background."
        " No text, no labels, no step-by-step, no collage, no split frames."
    )

    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        response = client.images.generate(
            model=model,
            prompt=prompt,
            n=1,
            size="1024x1024",
        )
        image_url = response.data[0].url
    except Exception:
        return None

    try:
        urllib.request.urlretrieve(image_url, dest)
        return dest
    except Exception:
        return None


def test_connection() -> dict:
    api_key = config.get("PPQ_API_KEY")
    if not api_key:
        return {"ok": False, "error": "PPQ_API_KEY not configured"}

    base_url = config.get("PPQ_BASE_URL", "https://api.ppq.ai/v1")
    model = config.get("PPQ_MODEL", "gpt-4o-mini")

    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        return {
            "ok": True,
            "model": model,
            "image_model": config.get("PPQ_IMAGE_MODEL", "dall-e-3"),
            "vision_model": config.get("PPQ_VISION_MODEL", "gpt-4o"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
