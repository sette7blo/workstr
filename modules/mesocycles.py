"""
modules/mesocycles.py — Mesocycle planner: multi-week training blocks
"""
import json
from datetime import date, timedelta
from core.db import db, rows_to_list, row_to_dict


def _parse_workout_ids(value) -> list:
    if isinstance(value, list):
        return value
    try:
        return json.loads(value or "[]")
    except (json.JSONDecodeError, TypeError):
        return []


def list_mesocycles() -> list:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM mesocycles ORDER BY start_date DESC"
        ).fetchall()
    result = []
    for m in rows_to_list(rows):
        m["workout_ids"] = []  # not needed in list view
        result.append(m)
    return result


def get_mesocycle(meso_id: int) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM mesocycles WHERE id=?", (meso_id,)).fetchone()
        if not row:
            return None
        m = row_to_dict(row)
        week_rows = conn.execute(
            "SELECT * FROM mesocycle_weeks WHERE mesocycle_id=? ORDER BY week_number",
            (meso_id,)
        ).fetchall()
        weeks_data = {}
        for w in rows_to_list(week_rows):
            w["workout_ids"] = _parse_workout_ids(w.get("workout_ids"))
            weeks_data[w["week_number"]] = w

        # Build full week list — fill in defaults for missing weeks
        weeks = []
        for n in range(1, m["weeks"] + 1):
            if n in weeks_data:
                weeks.append(weeks_data[n])
            else:
                weeks.append({
                    "mesocycle_id": meso_id,
                    "week_number": n,
                    "workout_ids": [],
                    "intensity_pct": 100,
                    "notes": None,
                })
        m["weeks_detail"] = weeks

    # Compute current week
    try:
        start = date.fromisoformat(m["start_date"])
        today = date.today()
        delta = (today - start).days
        m["current_week"] = max(1, min(m["weeks"], delta // 7 + 1)) if delta >= 0 else None
    except Exception:
        m["current_week"] = None

    return m


def create_mesocycle(name: str, goal: str = "hypertrophy", start_date: str = None,
                     weeks: int = 4, notes: str = None) -> dict:
    if not start_date:
        start_date = date.today().isoformat()
    with db() as conn:
        conn.execute(
            "INSERT INTO mesocycles (name, goal, start_date, weeks, notes) VALUES (?, ?, ?, ?, ?)",
            (name, goal, start_date, weeks, notes)
        )
        row = conn.execute("SELECT * FROM mesocycles ORDER BY id DESC LIMIT 1").fetchone()
    return get_mesocycle(row["id"])


def update_mesocycle(meso_id: int, data: dict) -> dict | None:
    allowed = {"name", "goal", "start_date", "weeks", "notes"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if fields:
        sets_clause = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [meso_id]
        with db() as conn:
            conn.execute(f"UPDATE mesocycles SET {sets_clause} WHERE id=?", vals)
    return get_mesocycle(meso_id)


def delete_mesocycle(meso_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM mesocycles WHERE id=?", (meso_id,))
    return cur.rowcount > 0


def upsert_week(meso_id: int, week_number: int, workout_ids: list = None,
                intensity_pct: int = 100, notes: str = None) -> dict:
    workout_ids_json = json.dumps(workout_ids or [])
    with db() as conn:
        conn.execute(
            """INSERT INTO mesocycle_weeks (mesocycle_id, week_number, workout_ids, intensity_pct, notes)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(mesocycle_id, week_number)
               DO UPDATE SET workout_ids=excluded.workout_ids,
                             intensity_pct=excluded.intensity_pct,
                             notes=excluded.notes""",
            (meso_id, week_number, workout_ids_json, intensity_pct, notes)
        )
        row = conn.execute(
            "SELECT * FROM mesocycle_weeks WHERE mesocycle_id=? AND week_number=?",
            (meso_id, week_number)
        ).fetchone()
    result = row_to_dict(row)
    result["workout_ids"] = _parse_workout_ids(result.get("workout_ids"))
    return result
