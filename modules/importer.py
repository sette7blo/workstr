"""
modules/importer.py — Sync JSON exercise files to SQLite
Exercises dir is the source of truth. SQLite is rebuilt from it.
"""
import json
import re
from pathlib import Path
from core.db import db, rows_to_list, row_to_dict

EXERCISES_DIR = Path(__file__).parent.parent / "exercises"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_exercise_json(path: Path) -> dict | None:
    try:
        with open(path) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    name = data.get("name", path.stem)
    slug = data.get("slug") or slugify(name)

    def _list_field(val):
        if isinstance(val, list):
            return json.dumps(val)
        if isinstance(val, str):
            return json.dumps([t.strip() for t in val.split(",") if t.strip()])
        return "[]"

    image = data.get("image", "")
    if isinstance(image, list):
        image = image[0] if image else ""

    return {
        "slug": slug,
        "name": name,
        "description": data.get("description", ""),
        "json_path": str(path.relative_to(EXERCISES_DIR.parent)),
        "image_url": image,
        "category": data.get("category", ""),
        "muscle_group": data.get("muscle_group", ""),
        "muscles": _list_field(data.get("muscles", [])),
        "equipment_list": _list_field(data.get("equipment", [])),
        "difficulty": data.get("difficulty", ""),
        "tags": _list_field(data.get("tags", [])),
        "instructions": json.dumps(data.get("instructions", [])),
        "source_type": data.get("source_type", "manual"),
        "status": data.get("status", "active"),
        "nostr_event_id": data.get("nostr_event_id"),
    }


def sync_all() -> dict:
    EXERCISES_DIR.mkdir(exist_ok=True)
    json_files = list(EXERCISES_DIR.glob("*.json"))
    synced, errors = 0, 0

    with db() as conn:
        for path in json_files:
            exercise = parse_exercise_json(path)
            if not exercise:
                errors += 1
                continue
            try:
                conn.execute("""
                    INSERT INTO exercises
                        (slug, name, description, json_path, image_url,
                         category, muscle_group, muscles, equipment_list,
                         difficulty, tags, instructions,
                         source_type, status, nostr_event_id)
                    VALUES
                        (:slug, :name, :description, :json_path, :image_url,
                         :category, :muscle_group, :muscles, :equipment_list,
                         :difficulty, :tags, :instructions,
                         :source_type, :status, :nostr_event_id)
                    ON CONFLICT(slug) DO UPDATE SET
                        name=excluded.name,
                        description=excluded.description,
                        image_url=excluded.image_url,
                        category=excluded.category,
                        muscle_group=excluded.muscle_group,
                        muscles=excluded.muscles,
                        equipment_list=excluded.equipment_list,
                        difficulty=excluded.difficulty,
                        tags=excluded.tags,
                        instructions=excluded.instructions,
                        source_type=excluded.source_type,
                        status=excluded.status,
                        nostr_event_id=COALESCE(excluded.nostr_event_id, exercises.nostr_event_id),
                        updated_at=datetime('now')
                """, exercise)
                synced += 1
            except Exception as e:
                print(f"Error syncing {path.name}: {e}")
                errors += 1

    return {"synced": synced, "errors": errors, "total": len(json_files)}


def save_exercise_json(data: dict, status: str = "staged") -> Path | None:
    EXERCISES_DIR.mkdir(exist_ok=True)
    slug = data.get("slug") or slugify(data.get("name", "exercise"))
    data["slug"] = slug
    data["status"] = status

    if status == "staged":
        with db() as conn:
            existing = conn.execute(
                "SELECT status FROM exercises WHERE slug=?", (slug,)
            ).fetchone()
            if existing and existing["status"] == "active":
                return None

    path = EXERCISES_DIR / f"{slug}.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    parsed = parse_exercise_json(path)
    if parsed:
        with db() as conn:
            conn.execute("""
                INSERT INTO exercises
                    (slug, name, description, json_path, image_url,
                     category, muscle_group, muscles, equipment_list,
                     difficulty, tags, instructions,
                     source_type, status, nostr_event_id)
                VALUES
                    (:slug, :name, :description, :json_path, :image_url,
                     :category, :muscle_group, :muscles, :equipment_list,
                     :difficulty, :tags, :instructions,
                     :source_type, :status, :nostr_event_id)
                ON CONFLICT(slug) DO UPDATE SET
                    name=excluded.name,
                    description=excluded.image_url,
                    category=excluded.category,
                    muscle_group=excluded.muscle_group,
                    muscles=excluded.muscles,
                    equipment_list=excluded.equipment_list,
                    difficulty=excluded.difficulty,
                    status=excluded.status,
                    nostr_event_id=COALESCE(excluded.nostr_event_id, exercises.nostr_event_id),
                    updated_at=datetime('now')
            """, parsed)
    return path


def get_exercise(slug: str) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM exercises WHERE slug=?", (slug,)).fetchone()
        if not row:
            return None
        r = row_to_dict(row)
        json_path = Path(__file__).parent.parent / r["json_path"]
        if json_path.exists():
            with open(json_path) as f:
                r["full"] = json.load(f)
        return r


def list_exercises(status: str = "active", page: int = 1, per_page: int = 24,
                   category: str = None, muscle_group: str = None) -> dict:
    offset = (page - 1) * per_page
    conditions = []
    params = []

    if status == "favorited":
        conditions.append("status='active' AND favorited=1")
    else:
        conditions.append("status=?")
        params.append(status)

    if category:
        conditions.append("category=?")
        params.append(category)
    if muscle_group:
        conditions.append("muscle_group=?")
        params.append(muscle_group)

    where = " AND ".join(conditions)

    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM exercises WHERE {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM exercises WHERE {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            params + [per_page, offset]
        ).fetchall()

    return {
        "exercises": rows_to_list(rows),
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    }


def update_exercise(slug: str, data: dict) -> dict | None:
    with db() as conn:
        row = conn.execute("SELECT json_path FROM exercises WHERE slug=?", (slug,)).fetchone()
    if not row:
        return None

    path = Path(__file__).parent.parent / row["json_path"]
    existing = {}
    if path.exists():
        with open(path) as f:
            existing = json.load(f)

    existing.update(data)
    with open(path, "w") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)

    parsed = parse_exercise_json(path)
    if parsed:
        with db() as conn:
            conn.execute("""
                UPDATE exercises SET
                    name=:name, description=:description, image_url=:image_url,
                    category=:category, muscle_group=:muscle_group, muscles=:muscles,
                    equipment_list=:equipment_list, difficulty=:difficulty,
                    tags=:tags, instructions=:instructions, updated_at=datetime('now')
                WHERE slug=:slug
            """, {**parsed, 'slug': slug})

    return get_exercise(slug)


def toggle_favorite(slug: str) -> dict:
    with db() as conn:
        row = conn.execute(
            "SELECT favorited FROM exercises WHERE slug=? AND status='active'", (slug,)
        ).fetchone()
        if not row:
            return None
        new_val = 0 if row["favorited"] else 1
        conn.execute("UPDATE exercises SET favorited=? WHERE slug=?", (new_val, slug))
    return {"favorited": bool(new_val)}


def approve_exercise(slug: str) -> bool:
    with db() as conn:
        cur = conn.execute(
            "UPDATE exercises SET status='active', updated_at=datetime('now') WHERE slug=? AND status='staged'",
            (slug,)
        )
        row = conn.execute("SELECT json_path FROM exercises WHERE slug=?", (slug,)).fetchone()
        if row:
            path = Path(__file__).parent.parent / row["json_path"]
            if path.exists():
                with open(path) as f:
                    data = json.load(f)
                data["status"] = "active"
                with open(path, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
        return cur.rowcount > 0


def trash_exercise(slug: str) -> bool:
    with db() as conn:
        row = conn.execute(
            "SELECT json_path, image_url, status FROM exercises WHERE slug=?", (slug,)
        ).fetchone()
        if not row:
            return False

        if row["status"] == "staged":
            json_path = Path(__file__).parent.parent / row["json_path"]
            if json_path.exists():
                json_path.unlink()
            base = Path(__file__).parent.parent
            for ext in ("jpg", "png", "webp"):
                img = base / "images" / f"{slug}.{ext}"
                if img.exists():
                    img.unlink()
            cur = conn.execute("DELETE FROM exercises WHERE slug=?", (slug,))
        else:
            cur = conn.execute(
                "UPDATE exercises SET status='trashed', updated_at=datetime('now') WHERE slug=?",
                (slug,)
            )
            json_path = Path(__file__).parent.parent / row["json_path"]
            if json_path.exists():
                with open(json_path) as f:
                    data = json.load(f)
                data["status"] = "trashed"
                with open(json_path, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)

        return cur.rowcount > 0


def restore_exercise(slug: str) -> bool:
    with db() as conn:
        row = conn.execute("SELECT * FROM exercises WHERE slug=? AND status='trashed'", (slug,)).fetchone()
        if not row:
            return False

        r = dict(row)
        json_path = Path(__file__).parent.parent / r["json_path"]

        if not json_path.exists():
            exercise = {
                "name": r["name"],
                "slug": slug,
                "description": r["description"] or "",
                "category": r["category"] or "",
                "muscle_group": r["muscle_group"] or "",
                "muscles": json.loads(r["muscles"] or "[]"),
                "equipment": json.loads(r["equipment_list"] or "[]"),
                "difficulty": r["difficulty"] or "",
                "tags": json.loads(r["tags"] or "[]"),
                "instructions": json.loads(r["instructions"] or "[]"),
                "source_type": r["source_type"] or "manual",
                "status": "active",
            }
            if r["image_url"]:
                exercise["image"] = r["image_url"]
            EXERCISES_DIR.mkdir(exist_ok=True)
            with open(json_path, "w") as f:
                json.dump(exercise, f, indent=2, ensure_ascii=False)
        else:
            with open(json_path) as f:
                data = json.load(f)
            data["status"] = "active"
            with open(json_path, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

        conn.execute(
            "UPDATE exercises SET status='active', updated_at=datetime('now') WHERE slug=?",
            (slug,)
        )
        return True


def permanent_delete_exercise(slug: str) -> bool:
    with db() as conn:
        row = conn.execute(
            "SELECT json_path, image_url FROM exercises WHERE slug=? AND status='trashed'", (slug,)
        ).fetchone()
        if not row:
            return False

        base = Path(__file__).parent.parent
        json_path = base / row["json_path"]
        if json_path.exists():
            json_path.unlink()

        if row["image_url"] and not row["image_url"].startswith("http"):
            img_path = base / row["image_url"]
            if img_path.exists():
                img_path.unlink()
        for ext in ("jpg", "png", "webp"):
            img_path = base / "images" / f"{slug}.{ext}"
            if img_path.exists():
                img_path.unlink()

        cur = conn.execute("DELETE FROM exercises WHERE slug=?", (slug,))
        return cur.rowcount > 0
