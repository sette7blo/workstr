"""
server.py — Workstr Flask application
Run: python server.py
"""
import csv
import gzip
import io
import json
from datetime import date
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, Response

import core.config as config
from core.schema import init_db
from modules import importer, equipment, workout_log, workout_planner, workouts
from modules import ai_generator, ai_planner, camera, seed_browser, nostr_backup, recovery
from modules import mesocycles as meso_module

app = Flask(__name__, static_folder="frontend", static_url_path="")


@app.after_request
def compress_and_cache(response):
    if (response.status_code < 200 or response.status_code >= 300
            or 'Content-Encoding' in response.headers):
        return response

    ct = response.content_type or ''
    if ('gzip' in request.headers.get('Accept-Encoding', '')
            and any(t in ct for t in ('text/', 'application/json', 'application/javascript', 'image/svg'))):
        if response.direct_passthrough:
            response.direct_passthrough = False
        data = response.get_data()
        if len(data) >= 512:
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as f:
                f.write(data)
            compressed = buf.getvalue()
            if len(compressed) < len(data):
                response.set_data(compressed)
                response.headers['Content-Encoding'] = 'gzip'
                response.headers['Content-Length'] = len(compressed)
                response.headers['Vary'] = 'Accept-Encoding'

    path = request.path
    if path.startswith('/images/'):
        response.headers['Cache-Control'] = 'public, max-age=86400'
    elif path in ('/favicon.svg',):
        response.headers['Cache-Control'] = 'public, max-age=604800'
    elif path == '/':
        response.headers['Cache-Control'] = 'no-cache'

    return response

# ── Init ──────────────────────────────────────────────────────────────────────

init_db()

# ── Static / SPA ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.route("/favicon.svg")
def favicon():
    return send_from_directory("frontend", "favicon.svg")


@app.route("/images/<path:filename>")
def serve_image(filename):
    return send_from_directory("images", filename)

# ── Exercises ─────────────────────────────────────────────────────────────────

@app.route("/api/exercises")
def api_list_exercises():
    status = request.args.get("status", "active")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 48))
    category = request.args.get("category")
    muscle_group = request.args.get("muscle_group")
    return jsonify(importer.list_exercises(status, page, per_page, category, muscle_group))


@app.route("/api/exercises/counts")
def api_exercise_counts():
    """Return status counts for sidebar badges."""
    from core.db import db
    with db() as conn:
        staged = conn.execute("SELECT COUNT(*) FROM exercises WHERE status='staged'").fetchone()[0]
        trashed = conn.execute("SELECT COUNT(*) FROM exercises WHERE status='trashed'").fetchone()[0]
        active = conn.execute("SELECT COUNT(*) FROM exercises WHERE status='active'").fetchone()[0]
    return jsonify({"active": active, "staged": staged, "trashed": trashed})


@app.route("/api/exercises/recent")
def api_exercises_recent():
    """Return the most recently logged active exercises (distinct, ordered by last use)."""
    limit = int(request.args.get("limit", 10))
    from core.db import db, rows_to_list
    with db() as conn:
        rows = conn.execute("""
            SELECT e.slug, e.name, e.muscle_group, e.image_url,
                   e.favorited, e.tags, e.difficulty,
                   3 as default_sets, '8-12' as default_reps, 90 as default_rest_sec
            FROM (
                SELECT exercise_slug, MAX(ws.finished_at) as last_used
                FROM workout_session_sets wss
                JOIN workout_sessions ws ON ws.id = wss.session_id
                WHERE ws.finished_at IS NOT NULL
                GROUP BY exercise_slug
                ORDER BY last_used DESC
                LIMIT ?
            ) recent
            JOIN exercises e ON e.slug = recent.exercise_slug
            WHERE e.status = 'active'
        """, (limit,)).fetchall()
    return jsonify(rows_to_list(rows))


@app.route("/api/exercises/<slug>/progress")
def api_exercise_progress(slug):
    return jsonify(workout_log.get_progress(slug))


@app.route("/api/exercises/<slug>")
def api_get_exercise(slug):
    ex = importer.get_exercise(slug)
    if not ex:
        return jsonify({"error": "not found"}), 404
    return jsonify(ex)


@app.route("/api/exercises/<slug>", methods=["PUT"])
def api_update_exercise(slug):
    data = request.get_json(force=True)
    result = importer.update_exercise(slug, data)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/exercises/<slug>/favorite", methods=["POST"])
def api_toggle_favorite(slug):
    data = request.get_json(force=True) or {}
    from core.db import db
    val = 1 if data.get("favorited") else 0
    with db() as conn:
        conn.execute("UPDATE exercises SET favorited=? WHERE slug=?", (val, slug))
    return jsonify({"ok": True, "favorited": bool(val)})


@app.route("/api/exercises/approve/<slug>", methods=["POST"])
def api_approve_exercise(slug):
    ok = importer.approve_exercise(slug)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/exercises/<slug>", methods=["DELETE"])
def api_trash_exercise(slug):
    ok = importer.trash_exercise(slug)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/exercises/restore/<slug>", methods=["POST"])
def api_restore_exercise(slug):
    ok = importer.restore_exercise(slug)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/exercises/permanent/<slug>", methods=["DELETE"])
def api_permanent_delete(slug):
    ok = importer.permanent_delete_exercise(slug)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/exercises/sync", methods=["POST"])
def api_sync():
    result = importer.sync_all()
    return jsonify(result)


@app.route("/api/import/manual", methods=["POST"])
def api_import_manual():
    data = request.get_json(force=True)
    path = importer.save_exercise_json(data, status="active")
    if not path:
        return jsonify({"error": "exercise already exists"}), 409
    return jsonify({"ok": True, "slug": data.get("slug")})

# ── Equipment ─────────────────────────────────────────────────────────────────

@app.route("/api/equipment")
def api_list_equipment():
    return jsonify(equipment.list_equipment())


@app.route("/api/equipment", methods=["POST"])
def api_add_equipment():
    data = request.get_json(force=True)
    result = equipment.add_equipment(
        name=data["name"],
        category=data.get("category"),
        owned=data.get("owned", True),
        notes=data.get("notes"),
    )
    return jsonify(result), 201


@app.route("/api/equipment/<int:eq_id>", methods=["PUT"])
def api_update_equipment(eq_id):
    data = request.get_json(force=True)
    result = equipment.update_equipment(eq_id, data)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/equipment/<int:eq_id>", methods=["DELETE"])
def api_delete_equipment(eq_id):
    ok = equipment.delete_equipment(eq_id)
    return jsonify({"ok": ok}), 200 if ok else 404

# ── Workout Log ───────────────────────────────────────────────────────────────

@app.route("/api/log", methods=["POST"])
def api_log_workout():
    data = request.get_json(force=True)
    result = workout_log.log_workout(
        exercise_slug=data["exercise_slug"],
        sets=data.get("sets"),
        duration_sec=data.get("duration_sec"),
        notes=data.get("notes"),
    )
    return jsonify(result), 201


@app.route("/api/log/<slug>")
def api_get_log(slug):
    limit = int(request.args.get("limit", 20))
    return jsonify(workout_log.get_log_for_exercise(slug, limit))


@app.route("/api/log/history")
def api_log_history():
    limit = int(request.args.get("limit", 50))
    return jsonify(workout_log.get_history(limit))


@app.route("/api/log/<int:log_id>", methods=["DELETE"])
def api_delete_log(log_id):
    ok = workout_log.delete_log_entry(log_id)
    return jsonify({"ok": ok}), 200 if ok else 404

# ── Workout Planner ───────────────────────────────────────────────────────────

@app.route("/api/plan")
def api_get_plan():
    week = request.args.get("week")
    if not week:
        week = date.today().isoformat()
    return jsonify(workout_planner.get_week(week))


@app.route("/api/plan", methods=["POST"])
def api_add_to_plan():
    data = request.get_json(force=True)
    result = workout_planner.add_to_plan(
        date=data["date"],
        slot=data["slot"],
        exercise_slug=data.get("exercise_slug"),
        template_id=data.get("template_id"),
        workout_id=data.get("workout_id"),
        notes=data.get("notes"),
    )
    return jsonify(result), 201


@app.route("/api/plan/<int:plan_id>", methods=["DELETE"])
def api_remove_from_plan(plan_id):
    ok = workout_planner.remove_from_plan(plan_id)
    return jsonify({"ok": ok}), 200 if ok else 404

# ── Workouts ──────────────────────────────────────────────────────────────────

@app.route("/api/workouts")
def api_list_workouts():
    return jsonify(workouts.list_workouts())


@app.route("/api/workouts", methods=["POST"])
def api_create_workout():
    data = request.get_json(force=True)
    result = workouts.create_workout(name=data["name"], description=data.get("description"))
    return jsonify(result), 201


@app.route("/api/workouts/<int:wid>")
def api_get_workout(wid):
    w = workouts.get_workout(wid)
    if not w:
        return jsonify({"error": "not found"}), 404
    return jsonify(w)


@app.route("/api/workouts/<int:wid>", methods=["PUT"])
def api_update_workout(wid):
    data = request.get_json(force=True)
    w = workouts.update_workout(wid, data)
    if not w:
        return jsonify({"error": "not found"}), 404
    return jsonify(w)


@app.route("/api/workouts/<int:wid>", methods=["DELETE"])
def api_delete_workout(wid):
    ok = workouts.delete_workout(wid)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/workouts/<int:wid>/exercises", methods=["POST"])
def api_add_exercise_to_workout(wid):
    data = request.get_json(force=True)
    result = workouts.add_exercise(
        workout_id=wid,
        exercise_slug=data["exercise_slug"],
        sets=int(data.get("sets", 3)),
        reps=str(data.get("reps", "8-12")),
        weight=data.get("weight"),
        rest_sec=int(data.get("rest_sec", 90)),
        notes=data.get("notes"),
        superset_group=data.get("superset_group"),
    )
    return jsonify(result), 201


@app.route("/api/workouts/<int:wid>/exercises/<int:ex_id>", methods=["PUT"])
def api_update_workout_exercise(wid, ex_id):
    data = request.get_json(force=True)
    result = workouts.update_exercise(ex_id, data)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/workouts/<int:wid>/exercises/<int:ex_id>", methods=["DELETE"])
def api_remove_workout_exercise(wid, ex_id):
    ok = workouts.remove_exercise(ex_id)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/workouts/<int:wid>/reorder", methods=["POST"])
def api_reorder_workout_exercises(wid):
    data = request.get_json(force=True)
    workouts.reorder_exercises(wid, data.get("ordered_ids", []))
    return jsonify({"ok": True})

# ── Recovery ──────────────────────────────────────────────────────────────────

@app.route("/api/recovery")
def api_recovery():
    return jsonify(recovery.get_recovery())


@app.route("/api/recovery/quick-workout", methods=["POST"])
def api_quick_workout():
    data = request.get_json(force=True) or {}
    duration = int(data.get("duration_minutes", 45))
    min_rec = int(data.get("min_recovery_percent", 80))
    return jsonify(recovery.get_quick_workout(duration, min_rec))

# ── Sessions ───────────────────────────────────────────────────────────────────

@app.route("/api/sessions", methods=["POST"])
def api_start_session():
    data = request.get_json(force=True)
    result = workouts.start_session(workout_id=data.get("workout_id"))
    return jsonify(result), 201


@app.route("/api/sessions")
def api_list_sessions():
    limit = int(request.args.get("limit", 50))
    return jsonify(workouts.list_sessions(limit))


@app.route("/api/sessions/<int:sid>")
def api_get_session(sid):
    s = workouts.get_session(sid)
    if not s:
        return jsonify({"error": "not found"}), 404
    return jsonify(s)


@app.route("/api/sessions/<int:sid>", methods=["PUT"])
def api_finish_session(sid):
    data = request.get_json(force=True)
    result = workouts.finish_session(sid, notes=data.get("notes"))
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/sessions/<int:sid>", methods=["DELETE"])
def api_cancel_session(sid):
    ok = workouts.cancel_session(sid)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.route("/api/sessions/<int:sid>/sets", methods=["POST"])
def api_log_set(sid):
    data = request.get_json(force=True)
    result = workouts.log_set(
        session_id=sid,
        exercise_slug=data["exercise_slug"],
        set_number=int(data["set_number"]),
        actual_reps=data.get("actual_reps"),
        actual_weight=data.get("actual_weight"),
        prescribed_reps=data.get("prescribed_reps"),
        prescribed_weight=data.get("prescribed_weight"),
    )
    return jsonify(result), 201


@app.route("/api/exercises/<slug>/last-sets")
def api_last_sets(slug):
    before = request.args.get("before_session")
    return jsonify(workouts.get_last_sets(slug, int(before) if before else None))

# ── Templates ─────────────────────────────────────────────────────────────────

@app.route("/api/templates")
def api_list_templates():
    return jsonify(workout_planner.list_templates())


@app.route("/api/templates", methods=["POST"])
def api_create_template():
    data = request.get_json(force=True)
    result = workout_planner.create_template(
        name=data["name"],
        description=data.get("description"),
        category=data.get("category"),
        exercises=data.get("exercises"),
    )
    return jsonify(result), 201


@app.route("/api/templates/<int:tid>", methods=["PUT"])
def api_update_template(tid):
    data = request.get_json(force=True)
    result = workout_planner.update_template(tid, data)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/templates/<int:tid>", methods=["DELETE"])
def api_delete_template(tid):
    ok = workout_planner.delete_template(tid)
    return jsonify({"ok": ok}), 200 if ok else 404

# ── AI ────────────────────────────────────────────────────────────────────────

@app.route("/api/ai/test")
def api_ai_test():
    return jsonify(ai_generator.test_connection())


@app.route("/api/ai/generate", methods=["POST"])
def api_ai_generate():
    data = request.get_json(force=True)
    prompt = data.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400
    try:
        result = ai_generator.generate_exercise(prompt)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ai/plan", methods=["POST"])
def api_ai_plan():
    data = request.get_json(force=True)
    week_start = data.get("week_start")
    if not week_start:
        return jsonify({"error": "week_start required"}), 400
    try:
        result = ai_planner.generate_plan(
            week_start=week_start,
            days_per_week=int(data.get("days_per_week", 4)),
            goal=data.get("goal", "general fitness"),
            equipment_filter=data.get("equipment_filter") or None,
            muscle_focus=data.get("muscle_focus") or None,
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Camera import ─────────────────────────────────────────────────────────────

@app.route("/api/import/camera", methods=["POST"])
def api_import_camera():
    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "no images provided"}), 400
    images = [(f.read(), f.filename) for f in files]
    try:
        result = camera.import_from_images(images)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Seed browser ──────────────────────────────────────────────────────────────

@app.route("/api/seed/browse")
def api_seed_browse():
    q = request.args.get("q", "")
    category = request.args.get("category", "")
    muscle = request.args.get("muscle", "")
    equip = request.args.get("equipment", "")
    level = request.args.get("level", "")
    limit = int(request.args.get("limit", 60))
    offset = int(request.args.get("offset", 0))
    try:
        data = seed_browser.browse(q, category, muscle, equip, level, limit, offset)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/seed/filters")
def api_seed_filters():
    try:
        return jsonify({
            "categories": seed_browser.list_categories(),
            "muscles": seed_browser.list_muscles(),
            "equipment": seed_browser.list_equipment(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/seed/import", methods=["POST"])
def api_seed_import():
    data = request.get_json(force=True)
    seed_id = data.get("seed_id")
    if not seed_id:
        return jsonify({"error": "seed_id required"}), 400
    result = seed_browser.import_exercise(seed_id)
    if not result:
        return jsonify({"error": "exercise not found in seed database"}), 404
    return jsonify(result)

# ── Settings ──────────────────────────────────────────────────────────────────

SETTINGS_KEYS = [
    "PPQ_API_KEY", "PPQ_BASE_URL", "PPQ_MODEL", "PPQ_IMAGE_MODEL", "PPQ_VISION_MODEL",
    "EQUIPMENT",
]


@app.route("/api/settings")
def api_get_settings():
    return jsonify({k: config.get(k, "") for k in SETTINGS_KEYS})


@app.route("/api/settings", methods=["POST"])
def api_save_settings():
    data = request.get_json(force=True)
    updates = {}
    for key in SETTINGS_KEYS:
        if key in data:
            updates[key] = (data[key] or "").strip()
    if updates:
        config.save_env(updates)
    return jsonify({"ok": True})

# ── Nostr backup ──────────────────────────────────────────────────────────────

@app.route("/api/nostr/sign", methods=["POST"])
def api_nostr_sign():
    """Sign all active exercises as Nostr Kind 30078 events. Returns event list for client-side relay publish."""
    nsec = config.get("NOSTR_NSEC", "").strip()
    if not nsec:
        return jsonify({"error": "NOSTR_NSEC not configured"}), 400
    try:
        events = nostr_backup.sign_all_exercises(nsec)
        relay = config.get("NOSTR_RELAY", "")
        return jsonify({"events": events, "relay": relay, "count": len(events)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/nostr/restore", methods=["POST"])
def api_nostr_restore():
    """Restore exercises from a list of Nostr events (JSON array in body)."""
    data = request.get_json(force=True)
    events = data if isinstance(data, list) else data.get("events", [])
    try:
        result = nostr_backup.restore_from_events(events)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Nostr identity ────────────────────────────────────────────────────────────

@app.route("/api/nostr/note", methods=["POST"])
def api_nostr_note():
    """Sign a Kind 1 note with the stored nsec. Returns signed event for client-side publishing."""
    nsec = config.get("NOSTR_NSEC", "").strip()
    if not nsec:
        return jsonify({"error": "NOSTR_NSEC not configured"}), 400
    data = request.get_json(force=True) or {}
    content = data.get("content", "")
    tags = data.get("tags", [])
    try:
        from pynostr.key import PrivateKey
        from pynostr.event import Event
        pk = PrivateKey.from_nsec(nsec) if nsec.startswith("nsec") else PrivateKey(bytes.fromhex(nsec))
        event = Event(content=content, pubkey=pk.public_key.hex(), kind=1, tags=tags)
        event.sign(pk.hex())
        relay = config.get("NOSTR_RELAY", "")
        return jsonify({"event": event.to_dict(), "relay": relay})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/nostr/identity", methods=["GET"])
def api_nostr_identity_get():
    nsec = config.get("NOSTR_NSEC", "").strip()
    if not nsec:
        return jsonify({"configured": False})
    try:
        from pynostr.key import PrivateKey
        pk = PrivateKey.from_nsec(nsec) if nsec.startswith("nsec") else PrivateKey(bytes.fromhex(nsec))
        pubkey_hex = pk.public_key.hex()
        npub = pk.public_key.bech32()
        relay = config.get("NOSTR_RELAY", "")
        return jsonify({"configured": True, "pubkey_hex": pubkey_hex, "npub": npub, "relay": relay})
    except Exception as e:
        return jsonify({"configured": False, "error": str(e)})


@app.route("/api/nostr/identity", methods=["POST"])
def api_nostr_identity_post():
    data = request.get_json(force=True) or {}
    nsec = (data.get("nsec") or "").strip()
    if not nsec:
        return jsonify({"error": "nsec required"}), 400
    try:
        from pynostr.key import PrivateKey
        pk = PrivateKey.from_nsec(nsec) if nsec.startswith("nsec") else PrivateKey(bytes.fromhex(nsec))
        pubkey_hex = pk.public_key.hex()
        npub = pk.public_key.bech32()
        config.save_env({"NOSTR_NSEC": nsec})
        relay = config.get("NOSTR_RELAY", "")
        return jsonify({"ok": True, "pubkey_hex": pubkey_hex, "npub": npub, "relay": relay})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/nostr/identity", methods=["DELETE"])
def api_nostr_identity_delete():
    config.save_env({"NOSTR_NSEC": ""})
    return jsonify({"ok": True})


# ── Mesocycles ─────────────────────────────────────────────────────────────────

@app.route("/api/mesocycles")
def api_list_mesocycles():
    return jsonify(meso_module.list_mesocycles())


@app.route("/api/mesocycles", methods=["POST"])
def api_create_mesocycle():
    data = request.get_json(force=True) or {}
    result = meso_module.create_mesocycle(
        name=data["name"],
        goal=data.get("goal", "hypertrophy"),
        start_date=data.get("start_date"),
        weeks=int(data.get("weeks", 4)),
        notes=data.get("notes"),
    )
    return jsonify(result), 201


@app.route("/api/mesocycles/<int:mid>")
def api_get_mesocycle(mid):
    m = meso_module.get_mesocycle(mid)
    if not m:
        return jsonify({"error": "not found"}), 404
    return jsonify(m)


@app.route("/api/mesocycles/<int:mid>", methods=["PUT"])
def api_update_mesocycle(mid):
    data = request.get_json(force=True) or {}
    result = meso_module.update_mesocycle(mid, data)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/mesocycles/<int:mid>", methods=["DELETE"])
def api_delete_mesocycle(mid):
    ok = meso_module.delete_mesocycle(mid)
    return jsonify({"ok": ok})


@app.route("/api/mesocycles/<int:mid>/weeks/<int:week_num>", methods=["PUT"])
def api_upsert_mesocycle_week(mid, week_num):
    data = request.get_json(force=True) or {}
    result = meso_module.upsert_week(
        meso_id=mid,
        week_number=week_num,
        workout_ids=data.get("workout_ids", []),
        intensity_pct=int(data.get("intensity_pct", 100)),
        notes=data.get("notes"),
    )
    return jsonify(result)


# ── Export ─────────────────────────────────────────────────────────────────────

@app.route("/api/export/log.json")
def api_export_log_json():
    limit = int(request.args.get("limit", 10000))
    entries = workout_log.get_history(limit)
    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    return Response(
        payload,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=workout_log.json"},
    )


@app.route("/api/export/log.csv")
def api_export_log_csv():
    limit = int(request.args.get("limit", 10000))
    entries = workout_log.get_history(limit)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "date", "exercise_slug", "exercise_name", "set_number", "reps", "weight_kg", "duration_sec", "notes"])
    for e in entries:
        sets = e.get("sets") or []
        if not sets:
            writer.writerow([e["id"], (e.get("logged_at") or "")[:10], e.get("exercise_slug", ""), e.get("exercise_name", ""), "", "", "", e.get("duration_sec", ""), e.get("notes", "")])
        else:
            for i, s in enumerate(sets, 1):
                if not s:
                    continue
                writer.writerow([e["id"], (e.get("logged_at") or "")[:10], e.get("exercise_slug", ""), e.get("exercise_name", ""), i, s.get("reps", ""), s.get("weight", ""), e.get("duration_sec", ""), e.get("notes", "")])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=workout_log.csv"},
    )

# ── Version ────────────────────────────────────────────────────────────────────

@app.route("/api/version")
def api_version():
    version_file = Path(__file__).parent / "VERSION"
    version = version_file.read_text().strip() if version_file.exists() else "dev"
    return jsonify({"version": version})

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = config.get("FLASK_HOST", "0.0.0.0")
    port = int(config.get("FLASK_PORT", "5001"))
    debug = config.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host=host, port=port, debug=debug)
