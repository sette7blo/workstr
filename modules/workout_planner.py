"""
modules/workout_planner.py — Weekly workout plan + templates
"""
import json
from core.db import db, rows_to_list, row_to_dict


def get_week(start_date: str) -> list:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM workout_plan WHERE date >= ? AND date < date(?, '+7 days') ORDER BY date, slot",
            (start_date, start_date)
        ).fetchall()
    return rows_to_list(rows)


def add_to_plan(date: str, slot: str, exercise_slug: str = None,
                template_id: int = None, notes: str = None) -> dict:
    with db() as conn:
        conn.execute(
            "INSERT INTO workout_plan (date, slot, exercise_slug, template_id, notes) VALUES (?, ?, ?, ?, ?)",
            (date, slot, exercise_slug, template_id, notes)
        )
        row = conn.execute("SELECT * FROM workout_plan ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def remove_from_plan(plan_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workout_plan WHERE id=?", (plan_id,))
    return cur.rowcount > 0


# Templates

def list_templates() -> list:
    with db() as conn:
        rows = conn.execute("SELECT * FROM workout_templates ORDER BY name").fetchall()
    result = []
    for r in rows_to_list(rows):
        if isinstance(r.get("exercises"), str):
            try:
                r["exercises"] = json.loads(r["exercises"])
            except (json.JSONDecodeError, TypeError):
                pass
        result.append(r)
    return result


def create_template(name: str, description: str = None, category: str = None,
                    exercises: list = None) -> dict:
    exercises_json = json.dumps(exercises or [])
    with db() as conn:
        conn.execute(
            "INSERT INTO workout_templates (name, description, category, exercises) VALUES (?, ?, ?, ?)",
            (name, description, category, exercises_json)
        )
        row = conn.execute("SELECT * FROM workout_templates ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def update_template(template_id: int, data: dict) -> dict | None:
    allowed = {"name", "description", "category", "exercises"}
    fields = {}
    for k, v in data.items():
        if k not in allowed:
            continue
        if k == "exercises" and isinstance(v, list):
            fields[k] = json.dumps(v)
        else:
            fields[k] = v

    if not fields:
        return None

    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [template_id]

    with db() as conn:
        conn.execute(f"UPDATE workout_templates SET {sets}, updated_at=datetime('now') WHERE id=?", vals)
        row = conn.execute("SELECT * FROM workout_templates WHERE id=?", (template_id,)).fetchone()
    return row_to_dict(row)


def delete_template(template_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workout_templates WHERE id=?", (template_id,))
    return cur.rowcount > 0
