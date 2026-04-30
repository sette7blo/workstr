"""
modules/recovery.py — Muscle recovery calculation and quick workout generation
"""
import json
from datetime import datetime, timezone
from core.db import get_connection

# Canonical muscle groups: base recovery hours by size
MUSCLE_CONFIG = {
    "Chest":       72,
    "Back":        72,
    "Quadriceps":  72,
    "Hamstrings":  72,
    "Lower Back":  72,
    "Shoulders":   48,
    "Glutes":      48,
    "Core":        48,
    "Traps":       48,
    "Biceps":      36,
    "Triceps":     36,
    "Forearms":    36,
    "Calves":      36,
}

# Normalize raw muscle names from the DB to canonical names
_ALIASES = {
    "chest": "Chest", "pectorals": "Chest", "pecs": "Chest",
    "back": "Back", "lats": "Back", "latissimus dorsi": "Back",
    "upper back": "Back", "mid back": "Back",
    "quadriceps": "Quadriceps", "quads": "Quadriceps", "legs": "Quadriceps",
    "hamstrings": "Hamstrings", "hamstring": "Hamstrings",
    "lower back": "Lower Back", "lumbar": "Lower Back", "erector spinae": "Lower Back",
    "shoulders": "Shoulders", "deltoids": "Shoulders", "deltoid": "Shoulders",
    "anterior deltoid": "Shoulders", "posterior deltoid": "Shoulders",
    "lateral deltoid": "Shoulders",
    "glutes": "Glutes", "glute": "Glutes", "gluteus maximus": "Glutes",
    "core": "Core", "abs": "Core", "abdominals": "Core", "obliques": "Core",
    "traps": "Traps", "trapezius": "Traps",
    "biceps": "Biceps", "bicep": "Biceps",
    "triceps": "Triceps", "tricep": "Triceps",
    "forearms": "Forearms", "forearm": "Forearms",
    "calves": "Calves", "calf": "Calves",
}


def _canon(name: str) -> str | None:
    return _ALIASES.get((name or "").lower().strip())


def _volume_multiplier(total_sets: float) -> float:
    if total_sets < 6:
        return 0.8
    if total_sets <= 12:
        return 1.0
    return 1.2


def _parse_dt(s: str) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def get_recovery() -> dict:
    """
    Return per-muscle-group recovery status derived from completed session history.
    """
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT
                wss.set_number,
                ws.finished_at,
                e.muscle_group,
                e.muscles
            FROM workout_session_sets wss
            JOIN workout_sessions ws ON wss.session_id = ws.id
            LEFT JOIN exercises e ON wss.exercise_slug = e.slug
            WHERE ws.finished_at IS NOT NULL
              AND ws.finished_at >= datetime('now', '-10 days')
            ORDER BY ws.finished_at DESC
        """).fetchall()
    finally:
        conn.close()

    now = datetime.now(timezone.utc)

    # Build: finished_at -> { canonical_muscle -> set_count (primary=1, secondary=0.5) }
    session_volumes: dict[str, dict[str, float]] = {}

    for row in rows:
        finished_at = row["finished_at"]
        if not finished_at:
            continue
        if finished_at not in session_volumes:
            session_volumes[finished_at] = {}
        sv = session_volumes[finished_at]

        primary = _canon(row["muscle_group"] or "")
        if primary:
            sv[primary] = sv.get(primary, 0) + 1

        try:
            muscles = json.loads(row["muscles"] or "[]")
        except (json.JSONDecodeError, TypeError):
            muscles = []
        for m in muscles:
            c = _canon(str(m))
            if c and c != primary:
                sv[c] = sv.get(c, 0) + 0.5

    sorted_sessions = sorted(session_volumes.keys(), reverse=True)

    result = {}
    for muscle, base_hours in MUSCLE_CONFIG.items():
        last_trained = None
        total_sets = 0.0

        for finished_at in sorted_sessions:
            sv = session_volumes[finished_at]
            if muscle not in sv:
                continue
            if last_trained is None:
                last_trained = finished_at
                total_sets = sv[muscle]
            else:
                # Accumulate sets from earlier sessions still within the recovery window
                try:
                    gap_h = (_parse_dt(last_trained) - _parse_dt(finished_at)).total_seconds() / 3600
                    if gap_h <= base_hours:
                        total_sets += sv[muscle]
                except Exception:
                    pass

        if last_trained is None:
            result[muscle] = {
                "percent": 100,
                "status": "untrained",
                "last_trained": None,
                "hours_remaining": 0,
                "total_sets": 0,
            }
            continue

        hours_elapsed = (now - _parse_dt(last_trained)).total_seconds() / 3600
        adjusted_hours = base_hours * _volume_multiplier(total_sets)
        percent = min(100, int((hours_elapsed / adjusted_hours) * 100))
        hours_remaining = max(0.0, adjusted_hours - hours_elapsed)

        if percent >= 80:
            status = "ready"
        elif percent >= 50:
            status = "partial"
        else:
            status = "recovering"

        result[muscle] = {
            "percent": percent,
            "status": status,
            "last_trained": last_trained,
            "hours_remaining": round(hours_remaining, 1),
            "total_sets": int(total_sets),
        }

    ready = sum(1 for v in result.values() if v["status"] in ("ready", "untrained"))
    trained = [v for v in result.values() if v["status"] != "untrained"]
    overall = int(sum(v["percent"] for v in trained) / len(trained)) if trained else 100

    return {
        "muscle_groups": [
            {"name": k, **v} for k, v in result.items()
        ],
        "overall_readiness": overall,
        "ready_count": ready,
        "total_count": len(result),
    }


def get_quick_workout(duration_minutes: int = 45, min_recovery: int = 80) -> dict:
    """
    Build a workout from exercises targeting recovered muscle groups.
    Returns selected exercises plus a pool for client-side swapping.
    """
    recovery_data = get_recovery()
    muscle_status = {mg["name"]: mg for mg in recovery_data["muscle_groups"]}

    ready_muscles = [
        name for name, data in muscle_status.items()
        if data["percent"] >= min_recovery
    ]

    if not ready_muscles:
        return {"exercises": [], "pool": {}, "target_muscle_groups": [], "estimated_duration_min": 0}

    conn = get_connection()
    try:
        placeholders = ",".join("?" * len(ready_muscles))
        rows = conn.execute(f"""
            SELECT slug, name, muscle_group, tags, image_url
            FROM exercises
            WHERE status = 'active'
              AND muscle_group IN ({placeholders})
            ORDER BY name ASC
        """, ready_muscles).fetchall()

        logged_slugs = {
            r["exercise_slug"] for r in conn.execute(
                "SELECT DISTINCT exercise_slug FROM workout_session_sets"
            ).fetchall()
        }
    finally:
        conn.close()

    # Score and bucket exercises by muscle group
    by_muscle: dict[str, list] = {}
    for row in rows:
        mg = row["muscle_group"]
        try:
            tags = json.loads(row["tags"] or "[]")
        except (json.JSONDecodeError, TypeError):
            tags = []
        score = (1 if row["slug"] in logged_slugs else 0) + (1 if "compound" in tags else 0)
        entry = {
            "slug": row["slug"],
            "name": row["name"],
            "muscle_group": mg,
            "image_url": row["image_url"] or None,
            "sets": 3,
            "reps": "8-12",
            "rest_sec": 90,
            "score": score,
        }
        by_muscle.setdefault(mg, []).append(entry)

    for mg in by_muscle:
        by_muscle[mg].sort(key=lambda x: x["score"], reverse=True)

    # Round-robin selection across muscle groups
    min_per_exercise = 9  # ~3 sets × 3 min/set
    max_exercises = max(1, duration_minutes // min_per_exercise)

    pools = {mg: list(exs) for mg, exs in by_muscle.items()}
    selected = []
    muscle_keys = list(pools.keys())
    idx = 0

    while len(selected) < max_exercises:
        if not any(pools.values()):
            break
        mg = muscle_keys[idx % len(muscle_keys)]
        if pools.get(mg):
            ex = pools[mg].pop(0)
            selected.append({k: v for k, v in ex.items() if k != "score"})
        idx += 1

    # Return remaining pool items for client-side swap (strip score)
    pool_out = {}
    for mg, exs in pools.items():
        clean = [{k: v for k, v in e.items() if k != "score"} for e in exs]
        if clean:
            pool_out[mg] = clean

    target_groups = list({e["muscle_group"] for e in selected})
    return {
        "exercises": selected,
        "pool": pool_out,
        "target_muscle_groups": target_groups,
        "estimated_duration_min": len(selected) * min_per_exercise,
    }
