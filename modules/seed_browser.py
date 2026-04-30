"""
modules/seed_browser.py — Browse free-exercise-db and lazy-import selected exercises.
Data source: https://github.com/yuhonas/free-exercise-db
Exercises are fetched once, cached in memory for the process lifetime.
"""
import json
import time
import urllib.request
from modules.importer import save_exercise_json, slugify

EXERCISES_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"

_cache: list = []
_cache_time: float = 0
_CACHE_TTL = 3600  # 1 hour


def _fetch() -> list:
    global _cache, _cache_time
    if _cache and (time.time() - _cache_time) < _CACHE_TTL:
        return _cache

    req = urllib.request.Request(EXERCISES_URL, headers={"User-Agent": "liftme/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        _cache = json.loads(resp.read().decode("utf-8"))
        _cache_time = time.time()
    return _cache


def browse(q: str = "", category: str = "", muscle: str = "",
           equipment: str = "", level: str = "", limit: int = 60, offset: int = 0) -> dict:
    """Search free-exercise-db. Returns dict with results list and total match count."""
    try:
        all_ex = _fetch()
    except Exception as e:
        raise RuntimeError(f"Failed to fetch exercise database: {e}")

    q_lower = q.lower() if q else ""
    results = []
    total = 0

    for ex in all_ex:
        if q_lower and q_lower not in ex.get("name", "").lower():
            continue
        if category and ex.get("category", "").lower() != category.lower():
            continue
        if muscle:
            pm = [m.lower() for m in ex.get("primaryMuscles", [])]
            sm = [m.lower() for m in ex.get("secondaryMuscles", [])]
            if muscle.lower() not in pm + sm:
                continue
        if equipment and (ex.get("equipment") or "").lower() != equipment.lower():
            continue
        if level and ex.get("level", "").lower() != level.lower():
            continue
        total += 1
        if total > offset and len(results) < limit:
            results.append(_format(ex))

    return {"results": results, "total": total}


def get_one(seed_id: str) -> dict | None:
    try:
        all_ex = _fetch()
    except Exception:
        return None
    for ex in all_ex:
        if ex.get("id") == seed_id:
            return _format(ex)
    return None


def import_exercise(seed_id: str) -> dict | None:
    """Import a seed exercise as staged."""
    ex = get_one(seed_id)
    if not ex:
        return None

    path = save_exercise_json(ex, status="staged")
    if not path:
        # Already exists as active — return existing slug info
        return {"slug": ex["slug"], "already_exists": True}

    return ex


def _format(ex: dict) -> dict:
    """Map free-exercise-db format to liftme exercise JSON format."""
    name = ex.get("name", "")
    slug = slugify(name)

    primary = ex.get("primaryMuscles", [])
    secondary = ex.get("secondaryMuscles", [])
    all_muscles = primary + [m for m in secondary if m not in primary]

    eq = ex.get("equipment") or "body only"
    if isinstance(eq, str):
        equipment = ["Body Weight"] if eq.lower() in ("body only", "", "other") else [eq.title()]
    else:
        equipment = [e.title() for e in eq] if eq else ["Body Weight"]

    level = ex.get("level", "beginner").lower()
    difficulty_map = {"beginner": "beginner", "intermediate": "intermediate", "expert": "advanced"}
    difficulty = difficulty_map.get(level, "intermediate")

    instructions = ex.get("instructions", [])

    images = ex.get("images", [])
    image_url = (IMAGE_BASE + images[0]) if images else ""

    muscle_group = primary[0].title() if primary else ""

    return {
        "name": name,
        "slug": slug,
        "description": "",
        "category": ex.get("category", "strength"),
        "muscle_group": muscle_group,
        "muscles": [m.title() for m in all_muscles],
        "equipment": equipment,
        "difficulty": difficulty,
        "tags": [ex.get("force", ""), ex.get("mechanic", "")],
        "instructions": instructions,
        "default_sets": 3,
        "default_reps": "8-12",
        "default_rest_sec": 90,
        "image": image_url,
        "source_type": "seed",
        "seed_id": ex.get("id"),
    }


def list_categories() -> list:
    """Return distinct categories from the DB."""
    try:
        all_ex = _fetch()
    except Exception:
        return []
    return sorted(set(e.get("category", "") for e in all_ex if e.get("category")))


def list_muscles() -> list:
    try:
        all_ex = _fetch()
    except Exception:
        return []
    muscles = set()
    for e in all_ex:
        for m in e.get("primaryMuscles", []) + e.get("secondaryMuscles", []):
            if m:
                muscles.add(m)
    return sorted(muscles)


def list_equipment() -> list:
    try:
        all_ex = _fetch()
    except Exception:
        return []
    return sorted(set(e.get("equipment", "") for e in all_ex if e.get("equipment")))
