"""
modules/workout_log.py — Log workout sets/reps/weight (equivalent to cook_log)
"""
import json
from core.db import db, rows_to_list, row_to_dict


def log_workout(exercise_slug: str, sets: list = None, duration_sec: int = None, notes: str = None) -> dict:
    sets_json = json.dumps(sets or [])
    with db() as conn:
        conn.execute(
            "INSERT INTO workout_log (exercise_slug, sets, duration_sec, notes) VALUES (?, ?, ?, ?)",
            (exercise_slug, sets_json, duration_sec, notes)
        )
        row = conn.execute(
            "SELECT * FROM workout_log WHERE exercise_slug=? ORDER BY id DESC LIMIT 1",
            (exercise_slug,)
        ).fetchone()
    return row_to_dict(row)


def get_log_for_exercise(exercise_slug: str, limit: int = 20) -> list:
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM workout_log WHERE exercise_slug=? ORDER BY logged_at DESC LIMIT ?",
            (exercise_slug, limit)
        ).fetchall()
    result = []
    for r in rows_to_list(rows):
        if isinstance(r.get("sets"), str):
            try:
                r["sets"] = json.loads(r["sets"])
            except (json.JSONDecodeError, TypeError):
                pass
        result.append(r)
    return result


def get_last_logged(slugs: list) -> dict:
    if not slugs:
        return {}
    placeholders = ",".join("?" for _ in slugs)
    with db() as conn:
        rows = conn.execute(f"""
            SELECT exercise_slug, MAX(logged_at) as last_logged
            FROM workout_log
            WHERE exercise_slug IN ({placeholders})
            GROUP BY exercise_slug
        """, slugs).fetchall()
    return {r["exercise_slug"]: r["last_logged"] for r in rows}


def get_history(limit: int = 50) -> list:
    """All recent log entries with exercise name/image for the history view."""
    with db() as conn:
        rows = conn.execute("""
            SELECT wl.*, e.name as exercise_name, e.muscle_group, e.image_url
            FROM workout_log wl
            LEFT JOIN exercises e ON e.slug = wl.exercise_slug
            ORDER BY wl.logged_at DESC
            LIMIT ?
        """, (limit,)).fetchall()
    result = []
    for r in rows_to_list(rows):
        if isinstance(r.get("sets"), str):
            try:
                r["sets"] = json.loads(r["sets"])
            except (json.JSONDecodeError, TypeError):
                pass
        result.append(r)
    return result


def delete_log_entry(log_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workout_log WHERE id=?", (log_id,))
    return cur.rowcount > 0
