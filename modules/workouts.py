"""
modules/workouts.py — Workout programs, exercises within them, and session logging.
"""
from core.db import db, rows_to_list, row_to_dict


# ── Workout programs ───────────────────────────────────────────────────────────

def list_workouts() -> list:
    with db() as conn:
        rows = conn.execute(
            """SELECT w.*, COUNT(we.id) as exercise_count
               FROM workouts w
               LEFT JOIN workout_exercises we ON we.workout_id = w.id
               GROUP BY w.id ORDER BY w.name""",
        ).fetchall()
    return rows_to_list(rows)


def get_workout(workout_id: int) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM workouts WHERE id=?", (workout_id,)).fetchone()
        if not row:
            return None
        w = row_to_dict(row)
        exrows = conn.execute(
            """SELECT we.*, e.name as exercise_name, e.muscle_group, e.image_url,
                      e.difficulty, e.category
               FROM workout_exercises we
               LEFT JOIN exercises e ON e.slug = we.exercise_slug
               WHERE we.workout_id=? ORDER BY we.position""",
            (workout_id,)
        ).fetchall()
        w["exercises"] = rows_to_list(exrows)
    return w


def create_workout(name: str, description: str = None) -> dict:
    with db() as conn:
        conn.execute("INSERT INTO workouts (name, description) VALUES (?, ?)", (name, description))
        row = conn.execute("SELECT * FROM workouts ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def update_workout(workout_id: int, data: dict) -> dict | None:
    allowed = {"name", "description"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [workout_id]
        with db() as conn:
            conn.execute(f"UPDATE workouts SET {sets}, updated_at=datetime('now') WHERE id=?", vals)
    return get_workout(workout_id)


def delete_workout(workout_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workouts WHERE id=?", (workout_id,))
    return cur.rowcount > 0


# ── Exercises within a workout ─────────────────────────────────────────────────

def add_exercise(workout_id: int, exercise_slug: str, sets: int = 3, reps: str = "8-12",
                 weight: float = None, rest_sec: int = 90, notes: str = None,
                 superset_group: str = None) -> dict:
    with db() as conn:
        pos_row = conn.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM workout_exercises WHERE workout_id=?",
            (workout_id,)
        ).fetchone()
        position = pos_row["pos"] if pos_row else 0
        conn.execute(
            """INSERT INTO workout_exercises
               (workout_id, exercise_slug, position, sets, reps, weight, rest_sec, notes, superset_group)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (workout_id, exercise_slug, position, sets, reps, weight, rest_sec, notes, superset_group)
        )
        row = conn.execute("SELECT * FROM workout_exercises ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def update_exercise(ex_id: int, data: dict) -> dict | None:
    allowed = {"position", "sets", "reps", "weight", "rest_sec", "notes", "superset_group"}
    fields = {k: v for k, v in data.items() if k in allowed}
    if not fields:
        return None
    sets_clause = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [ex_id]
    with db() as conn:
        conn.execute(f"UPDATE workout_exercises SET {sets_clause} WHERE id=?", vals)
        row = conn.execute("SELECT * FROM workout_exercises WHERE id=?", (ex_id,)).fetchone()
    return row_to_dict(row) if row else None


def remove_exercise(ex_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workout_exercises WHERE id=?", (ex_id,))
    return cur.rowcount > 0


def reorder_exercises(workout_id: int, ordered_ids: list) -> bool:
    with db() as conn:
        for pos, ex_id in enumerate(ordered_ids):
            conn.execute(
                "UPDATE workout_exercises SET position=? WHERE id=? AND workout_id=?",
                (pos, ex_id, workout_id)
            )
    return True


# ── Session logging ────────────────────────────────────────────────────────────

def start_session(workout_id: int = None) -> dict:
    with db() as conn:
        conn.execute("INSERT INTO workout_sessions (workout_id) VALUES (?)", (workout_id,))
        row = conn.execute("SELECT * FROM workout_sessions ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def finish_session(session_id: int, notes: str = None) -> dict | None:
    with db() as conn:
        conn.execute(
            "UPDATE workout_sessions SET finished_at=datetime('now'), notes=? WHERE id=?",
            (notes, session_id)
        )
        row = conn.execute("SELECT * FROM workout_sessions WHERE id=?", (session_id,)).fetchone()
    return row_to_dict(row) if row else None


def cancel_session(session_id: int) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM workout_sessions WHERE id=? AND finished_at IS NULL", (session_id,))
    return cur.rowcount > 0


def log_set(session_id: int, exercise_slug: str, set_number: int,
            actual_reps: int = None, actual_weight: float = None,
            prescribed_reps: str = None, prescribed_weight: float = None) -> dict:
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM workout_session_sets WHERE session_id=? AND exercise_slug=? AND set_number=?",
            (session_id, exercise_slug, set_number)
        ).fetchone()
        if existing:
            conn.execute(
                """UPDATE workout_session_sets
                   SET actual_reps=?, actual_weight=?, prescribed_reps=?, prescribed_weight=?
                   WHERE id=?""",
                (actual_reps, actual_weight, prescribed_reps, prescribed_weight, existing["id"])
            )
            row = conn.execute("SELECT * FROM workout_session_sets WHERE id=?", (existing["id"],)).fetchone()
        else:
            conn.execute(
                """INSERT INTO workout_session_sets
                   (session_id, exercise_slug, set_number, actual_reps, actual_weight,
                    prescribed_reps, prescribed_weight)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, exercise_slug, set_number, actual_reps, actual_weight,
                 prescribed_reps, prescribed_weight)
            )
            row = conn.execute("SELECT * FROM workout_session_sets ORDER BY id DESC LIMIT 1").fetchone()
    return row_to_dict(row)


def get_session(session_id: int) -> dict | None:
    with db() as conn:
        row = conn.execute(
            """SELECT ws.*, w.name as workout_name
               FROM workout_sessions ws
               LEFT JOIN workouts w ON w.id = ws.workout_id
               WHERE ws.id=?""",
            (session_id,)
        ).fetchone()
        if not row:
            return None
        s = row_to_dict(row)
        sets = conn.execute(
            """SELECT wss.*, e.name as exercise_name, e.image_url
               FROM workout_session_sets wss
               LEFT JOIN exercises e ON e.slug = wss.exercise_slug
               WHERE wss.session_id=?
               ORDER BY wss.exercise_slug, wss.set_number""",
            (session_id,)
        ).fetchall()
        s["sets"] = rows_to_list(sets)
    return s


def list_sessions(limit: int = 50) -> list:
    with db() as conn:
        rows = conn.execute(
            """SELECT ws.*, w.name as workout_name,
               COUNT(DISTINCT wss.exercise_slug) as exercise_count,
               ROUND(SUM(COALESCE(wss.actual_reps,0) * COALESCE(wss.actual_weight,0)), 1) as total_volume
               FROM workout_sessions ws
               LEFT JOIN workouts w ON w.id = ws.workout_id
               LEFT JOIN workout_session_sets wss ON wss.session_id = ws.id
               WHERE ws.finished_at IS NOT NULL
               GROUP BY ws.id
               ORDER BY ws.started_at DESC
               LIMIT ?""",
            (limit,)
        ).fetchall()
    return rows_to_list(rows)


def get_last_sets(exercise_slug: str, before_session_id: int = None) -> list:
    """Return the sets logged in the most recent finished session for this exercise."""
    with db() as conn:
        if before_session_id:
            rows = conn.execute(
                """SELECT wss.session_id, wss.set_number, wss.actual_reps, wss.actual_weight
                   FROM workout_session_sets wss
                   JOIN workout_sessions ws ON ws.id = wss.session_id
                   WHERE wss.exercise_slug=? AND wss.session_id < ?
                     AND ws.finished_at IS NOT NULL
                   ORDER BY ws.started_at DESC, wss.set_number
                   LIMIT 20""",
                (exercise_slug, before_session_id)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT wss.session_id, wss.set_number, wss.actual_reps, wss.actual_weight
                   FROM workout_session_sets wss
                   JOIN workout_sessions ws ON ws.id = wss.session_id
                   WHERE wss.exercise_slug=? AND ws.finished_at IS NOT NULL
                   ORDER BY ws.started_at DESC, wss.set_number
                   LIMIT 20""",
                (exercise_slug,)
            ).fetchall()
    if not rows:
        return []
    all_sets = rows_to_list(rows)
    last_sid = all_sets[0]["session_id"]
    return [s for s in all_sets if s["session_id"] == last_sid]
