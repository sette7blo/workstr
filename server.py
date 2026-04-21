"""
server.py — Workstr Flask application
Run: python server.py
"""
import gzip
import io
import json
from datetime import date
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

import core.config as config
from core.schema import init_db
from modules import importer, equipment, workout_log, workout_planner
from modules import ai_generator, ai_planner, camera, seed_browser

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


@app.route("/api/exercises/favorite/<slug>", methods=["POST"])
def api_toggle_favorite(slug):
    result = importer.toggle_favorite(slug)
    if result is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


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
        notes=data.get("notes"),
    )
    return jsonify(result), 201


@app.route("/api/plan/<int:plan_id>", methods=["DELETE"])
def api_remove_from_plan(plan_id):
    ok = workout_planner.remove_from_plan(plan_id)
    return jsonify({"ok": ok}), 200 if ok else 404

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
    try:
        results = seed_browser.browse(q, category, muscle, equip, level, limit)
        return jsonify(results)
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

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = config.get("FLASK_HOST", "0.0.0.0")
    port = int(config.get("FLASK_PORT", "5001"))
    debug = config.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host=host, port=port, debug=debug)
