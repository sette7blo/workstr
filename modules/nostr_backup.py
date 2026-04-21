"""
modules/nostr_backup.py — Nostr Kind 30078 backup/restore for exercises.
Sign events server-side; relay publishing done client-side via WebSocket.
"""
import json
from pathlib import Path

from pynostr.key import PrivateKey
from pynostr.event import Event

from core.db import db
from modules.importer import save_exercise_json, EXERCISES_DIR

NOSTR_KIND = 30078
D_TAG_PREFIX = "workstr:exercise:"


def _load_key(nsec: str) -> PrivateKey:
    nsec = nsec.strip()
    if nsec.startswith("nsec"):
        return PrivateKey.from_nsec(nsec)
    return PrivateKey(bytes.fromhex(nsec))


def sign_exercise_event(exercise_json: dict, nsec: str) -> dict:
    """Build and sign a Kind 30078 event for one exercise. Returns the signed event dict."""
    pk = _load_key(nsec)
    slug = exercise_json.get("slug", "")
    content = json.dumps(exercise_json, ensure_ascii=False)
    event = Event(
        content=content,
        pubkey=pk.public_key.hex(),
        kind=NOSTR_KIND,
        tags=[
            ["d", f"{D_TAG_PREFIX}{slug}"],
            ["t", "workstr"],
            ["t", "exercise"],
        ],
    )
    event.sign(pk.hex())
    return event.to_dict()


def sign_all_exercises(nsec: str) -> list:
    """Sign all active exercises. Returns list of signed event dicts."""
    with db() as conn:
        rows = conn.execute(
            "SELECT slug, json_path FROM exercises WHERE status='active'"
        ).fetchall()

    events = []
    for row in rows:
        json_path = Path(__file__).parent.parent / row["json_path"]
        if not json_path.exists():
            continue
        try:
            with open(json_path) as f:
                data = json.load(f)
        except Exception:
            continue
        try:
            ev = sign_exercise_event(data, nsec)
            events.append(ev)
        except Exception:
            continue
    return events


def restore_from_events(events: list) -> dict:
    """
    Import exercise events (Kind 30078 tagged workstr+exercise) as staged exercises.
    Returns {imported, skipped, errors}.
    """
    imported = skipped = errors = 0
    for ev in events:
        if ev.get("kind") != NOSTR_KIND:
            errors += 1
            continue
        tags = {v for tag in ev.get("tags", []) if len(tag) >= 2 and tag[0] == "t" for v in [tag[1]]}
        if not ({"workstr", "exercise"} <= tags):
            errors += 1
            continue
        try:
            data = json.loads(ev.get("content", ""))
        except (json.JSONDecodeError, TypeError):
            errors += 1
            continue
        if not data.get("name"):
            errors += 1
            continue
        # Store nostr_event_id if available
        data["nostr_event_id"] = ev.get("id")
        path = save_exercise_json(data, status="staged")
        if path is None:
            skipped += 1
        else:
            imported += 1
    return {"imported": imported, "skipped": skipped, "errors": errors}
