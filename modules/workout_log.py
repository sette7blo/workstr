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


def get_progress(exercise_slug: str) -> list:
    """Return per-session 1RM (Epley) and volume for trend charts."""
    with db() as conn:
        rows = conn.execute("""
            SELECT
                ws.id as session_id,
                ws.finished_at,
                wss.actual_reps,
                wss.actual_weight
            FROM workout_session_sets wss
            JOIN workout_sessions ws ON ws.id = wss.session_id
            WHERE wss.exercise_slug = ?
              AND ws.finished_at IS NOT NULL
            ORDER BY ws.finished_at ASC
        """, (exercise_slug,)).fetchall()

    # Group by session
    sessions: dict = {}
    for r in rows_to_list(rows):
        sid = r["session_id"]
        if sid not in sessions:
            sessions[sid] = {"date": (r["finished_at"] or "")[:10], "sets": []}
        sessions[sid]["sets"].append({
            "reps": r["actual_reps"],
            "weight": r["actual_weight"],
        })

    result = []
    for data in sessions.values():
        best_1rm = 0
        total_volume = 0
        for s in data["sets"]:
            weight = s.get("weight") or 0
            reps = s.get("reps") or 0
            if weight and reps:
                one_rm = weight * (1 + reps / 30)
                if one_rm > best_1rm:
                    best_1rm = one_rm
                total_volume += weight * reps

        result.append({
            "date": data["date"],
            "best_1rm": round(best_1rm, 1) if best_1rm else None,
            "volume": round(total_volume, 1),
        })

    return result
