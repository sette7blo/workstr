"""
server.py — Liftme Flask application
Run: python server.py
"""
import gzip
import io
import json
from datetime import date
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory, Response

import core.config as config
from core.schema import init_db
from modules import importer, workout_log, workout_planner, workouts
from modules import ai_generator, camera, seed_browser, recovery
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
    elif path in ('/favicon.svg', '/apple-touch-icon.png'):
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


@app.route("/apple-touch-icon.png")
def apple_touch_icon():
    return send_from_directory("frontend", "apple-touch-icon.png")


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
                   e.tags, e.difficulty,
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


@app.route("/api/exercises/<slug>/regenerate-image", methods=["POST"])
def api_regenerate_image(slug):
    api_key = config.get("PPQ_API_KEY")
    if not api_key:
        return jsonify({"error": "No API key configured"}), 400
    ex = importer.get_exercise(slug)
    if not ex:
        return jsonify({"error": "Exercise not found"}), 404
    base_url = config.get("PPQ_BASE_URL", "https://api.ppq.ai/v1")
    image_model = config.get("PPQ_IMAGE_MODEL", "dall-e-3")
    full = ex.get("full", {})
    full.setdefault("name", ex.get("name", slug))
    try:
        image_path = ai_generator._generate_image(full, slug, api_key, base_url, image_model)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    if not image_path:
        return jsonify({"error": "Image generation failed"}), 500
    rel = f"images/{image_path.name}"
    importer.update_exercise(slug, {"image": rel})
    return jsonify({"ok": True, "image": rel})



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
    result = workouts.create_workout(
        name=data["name"],
        description=data.get("description"),
        is_temporary=data.get("is_temporary", False),
    )
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
    result = workouts.start_session(
        workout_id=data.get("workout_id"),
        workout_name=data.get("workout_name"),
    )
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
def api_delete_session(sid):
    ok = workouts.delete_session(sid)
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

# ── Statistics ─────────────────────────────────────────────────────────────────

@app.route("/api/stats")
def api_stats():
    from core.db import db, rows_to_list
    weeks = int(request.args.get("weeks", 12))
    with db() as conn:
        # Weekly volume (last N weeks)
        vol_rows = conn.execute("""
            SELECT strftime('%%Y-%%W', ws.started_at) as week_key,
                   MIN(date(ws.started_at)) as week_start,
                   COUNT(DISTINCT ws.id) as session_count,
                   ROUND(SUM(COALESCE(wss.actual_reps,0) * COALESCE(wss.actual_weight,0)), 1) as total_volume,
                   COUNT(wss.id) as total_sets
            FROM workout_sessions ws
            LEFT JOIN workout_session_sets wss ON wss.session_id = ws.id
            WHERE ws.finished_at IS NOT NULL
              AND ws.started_at >= date('now', ? || ' days')
            GROUP BY week_key
            ORDER BY week_key ASC
        """, (str(-weeks * 7),)).fetchall()
        weekly_volume = rows_to_list(vol_rows)

        # All finished session dates for streak / frequency
        date_rows = conn.execute("""
            SELECT DISTINCT date(started_at) as d
            FROM workout_sessions
            WHERE finished_at IS NOT NULL
            ORDER BY d DESC
        """).fetchall()
        session_dates = [r["d"] for r in date_rows]

        # Muscle group distribution (last 30 days) — aggregated by canonical group
        muscle_rows = conn.execute("""
            SELECT e.muscle_group, COUNT(DISTINCT wss.exercise_slug) as exercise_count,
                   COUNT(wss.id) as set_count
            FROM workout_session_sets wss
            JOIN workout_sessions ws ON ws.id = wss.session_id
            LEFT JOIN exercises e ON e.slug = wss.exercise_slug
            WHERE ws.finished_at IS NOT NULL
              AND ws.started_at >= date('now', '-30 days')
              AND e.muscle_group IS NOT NULL
            GROUP BY e.muscle_group
            ORDER BY set_count DESC
        """).fetchall()
        agg = {}
        for r in muscle_rows:
            canon = recovery._canon(r["muscle_group"]) or r["muscle_group"]
            if canon not in agg:
                agg[canon] = {"muscle_group": canon, "exercise_count": 0, "set_count": 0}
            agg[canon]["exercise_count"] += r["exercise_count"]
            agg[canon]["set_count"] += r["set_count"]
        muscle_distribution = sorted(agg.values(), key=lambda x: x["set_count"], reverse=True)

        # Personal records (best estimated 1RM per exercise, all time)
        pr_rows = conn.execute("""
            SELECT wss.exercise_slug, e.name as exercise_name, e.muscle_group,
                   wss.actual_reps, wss.actual_weight,
                   ws.finished_at
            FROM workout_session_sets wss
            JOIN workout_sessions ws ON ws.id = wss.session_id
            LEFT JOIN exercises e ON e.slug = wss.exercise_slug
            WHERE ws.finished_at IS NOT NULL
              AND wss.actual_weight > 0 AND wss.actual_reps > 0
            ORDER BY wss.exercise_slug, ws.finished_at ASC
        """).fetchall()

        # Compute best 1RM per exercise and track when PR was set
        pr_map = {}
        for r in rows_to_list(pr_rows):
            slug = r["exercise_slug"]
            w, reps = r["actual_weight"], r["actual_reps"]
            est_1rm = round(w * (1 + reps / 30), 1)
            if slug not in pr_map or est_1rm > pr_map[slug]["best_1rm"]:
                pr_map[slug] = {
                    "exercise_slug": slug,
                    "exercise_name": r["exercise_name"] or slug,
                    "muscle_group": r["muscle_group"],
                    "best_1rm": est_1rm,
                    "weight": w,
                    "reps": reps,
                    "date": (r["finished_at"] or "")[:10],
                }
        personal_records = sorted(pr_map.values(), key=lambda x: x["best_1rm"], reverse=True)

        # Per-exercise volume totals (for drill-down list)
        ex_rows = conn.execute("""
            SELECT wss.exercise_slug, e.name as exercise_name, e.muscle_group,
                   COUNT(DISTINCT ws.id) as session_count,
                   COUNT(wss.id) as total_sets,
                   ROUND(SUM(COALESCE(wss.actual_reps,0) * COALESCE(wss.actual_weight,0)), 1) as total_volume
            FROM workout_session_sets wss
            JOIN workout_sessions ws ON ws.id = wss.session_id
            LEFT JOIN exercises e ON e.slug = wss.exercise_slug
            WHERE ws.finished_at IS NOT NULL
            GROUP BY wss.exercise_slug
            ORDER BY total_volume DESC
        """).fetchall()
        exercise_totals = rows_to_list(ex_rows)

    # Compute streak
    from datetime import date as dt_date, timedelta
    today = dt_date.today()
    streak = 0
    check = today
    date_set = set(session_dates)
    # Allow today or yesterday as start
    if check.isoformat() not in date_set:
        check = today - timedelta(days=1)
    while check.isoformat() in date_set:
        streak += 1
        check -= timedelta(days=1)

    return jsonify({
        "weekly_volume": weekly_volume,
        "session_dates": session_dates,
        "streak": streak,
        "total_sessions": len(session_dates),
        "muscle_distribution": muscle_distribution,
        "personal_records": personal_records,
        "exercise_totals": exercise_totals,
    })


# ── AI ────────────────────────────────────────────────────────────────────────

@app.route("/api/ai/test")
def api_ai_test():
    return jsonify(ai_generator.test_connection())


@app.route("/api/ai/balance")
def api_ai_balance():
    credit_id = config.get("PPQ_CREDIT_ID", "")
    if not credit_id:
        return jsonify({"ok": False, "error": "No credit ID configured"})
    try:
        import urllib.request as _ur, json as _json
        body = _json.dumps({"credit_id": credit_id}).encode()
        rq = _ur.Request("https://api.ppq.ai/credits/balance",
                         data=body, headers={"Content-Type": "application/json"}, method="POST")
        with _ur.urlopen(rq, timeout=10) as resp:
            data = _json.loads(resp.read())
        return jsonify({"ok": True, "balance": data.get("balance", 0)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


TOPUP_METHODS = {"xmr": {"min": 5, "max": 10000}}


@app.route("/api/ai/topup", methods=["POST"])
def api_ai_topup():
    api_key = config.get("PPQ_API_KEY", "")
    if not api_key:
        return jsonify({"ok": False, "error": "No API key configured"}), 400
    data = request.get_json(force=True)
    method = data.get("method", "")
    amount = data.get("amount")
    currency = data.get("currency", "USD")
    if method not in TOPUP_METHODS:
        return jsonify({"ok": False, "error": f"Unsupported method. Use: {', '.join(TOPUP_METHODS)}"}), 400
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid amount"}), 400
    limits = TOPUP_METHODS[method]
    if currency == "USD" and (amount < limits["min"] or amount > limits["max"]):
        return jsonify({"ok": False, "error": f"Amount must be ${limits['min']}-${limits['max']} for {method}"}), 400
    try:
        import urllib.request as _ur, json as _json
        body = _json.dumps({"amount": amount, "currency": currency}).encode()
        rq = _ur.Request(f"https://api.ppq.ai/topup/create/{method}",
                         data=body,
                         headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                         method="POST")
        with _ur.urlopen(rq, timeout=15) as resp:
            result = _json.loads(resp.read())
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/ai/topup/status/<invoice_id>")
def api_ai_topup_status(invoice_id):
    api_key = config.get("PPQ_API_KEY", "")
    if not api_key:
        return jsonify({"ok": False, "error": "No API key configured"}), 400
    try:
        import urllib.request as _ur, json as _json
        rq = _ur.Request(f"https://api.ppq.ai/topup/status/{invoice_id}",
                         headers={"Authorization": f"Bearer {api_key}"}, method="GET")
        with _ur.urlopen(rq, timeout=10) as resp:
            result = _json.loads(resp.read())
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


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
    "PPQ_API_KEY", "PPQ_CREDIT_ID", "PPQ_BASE_URL", "PPQ_MODEL", "PPQ_IMAGE_MODEL", "PPQ_VISION_MODEL",
    "EQUIPMENT", "WEIGHT_UNIT", "USER_HEIGHT_CM", "BODY_WEIGHT_TARGET_KG",
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


# ── Body Tracking ─────────────────────────────────────────────────────────────

@app.route("/api/body")
def api_body_log():
    from core.db import db, rows_to_list
    limit = int(request.args.get("limit", 90))
    with db() as conn:
        rows = conn.execute(
            "SELECT id, date, weight_kg, notes FROM body_log ORDER BY date DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return jsonify(rows_to_list(rows))


@app.route("/api/body", methods=["POST"])
def api_body_log_add():
    from core.db import db
    data = request.get_json(force=True)
    weight = data.get("weight_kg")
    log_date = data.get("date", date.today().isoformat())
    notes = data.get("notes", "")
    if not weight:
        return jsonify({"error": "weight_kg required"}), 400
    try:
        weight = float(weight)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid weight"}), 400
    with db() as conn:
        conn.execute(
            """INSERT INTO body_log (date, weight_kg, notes)
               VALUES (?, ?, ?)
               ON CONFLICT(date) DO UPDATE SET weight_kg=excluded.weight_kg, notes=excluded.notes""",
            (log_date, weight, notes),
        )
    return jsonify({"ok": True}), 201


@app.route("/api/body/<int:entry_id>", methods=["DELETE"])
def api_body_log_delete(entry_id):
    from core.db import db
    with db() as conn:
        cur = conn.execute("DELETE FROM body_log WHERE id=?", (entry_id,))
    return jsonify({"ok": cur.rowcount > 0}), 200 if cur.rowcount else 404


# ── Backup & Restore ─────────────────────────────────────────────────────────

@app.route("/api/backup")
def api_download_backup():
    import zipfile
    import shutil
    base = Path(__file__).parent
    db_path = base / "data" / "liftme.db"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Database — copy first to avoid locking issues
        if db_path.exists():
            tmp = base / "data" / "liftme-backup-tmp.db"
            try:
                from core.db import db
                with db() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    shutil.copy2(str(db_path), str(tmp))
                    conn.rollback()
                zf.write(tmp, "liftme.db")
            finally:
                tmp.unlink(missing_ok=True)
        # Exercise JSON files
        exercises_dir = base / "exercises"
        if exercises_dir.exists():
            for f in exercises_dir.iterdir():
                if f.is_file() and f.suffix == '.json':
                    zf.write(f, f"exercises/{f.name}")
        # Images
        images_dir = base / "images"
        if images_dir.exists():
            for f in images_dir.iterdir():
                if f.is_file():
                    zf.write(f, f"images/{f.name}")
        # Settings (exclude secrets)
        settings = {}
        env_path = base / ".env"
        if env_path.exists():
            with open(env_path) as ef:
                for line in ef:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    k = k.strip()
                    if k in ("FLASK_SECRET",):
                        continue
                    settings[k] = v.strip()
        if settings:
            zf.writestr("settings.json", json.dumps(settings, indent=2))
    buf.seek(0)
    from datetime import datetime
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Response(
        buf.getvalue(),
        mimetype="application/zip",
        headers={"Content-Disposition": f"attachment; filename=liftme-backup-{ts}.zip"},
    )


@app.route("/api/backup/restore", methods=["POST"])
def api_restore_backup():
    import zipfile
    f = request.files.get("backup")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    if not f.filename.endswith(".zip"):
        return jsonify({"error": "File must be a .zip"}), 400
    buf = io.BytesIO(f.read())
    try:
        zf = zipfile.ZipFile(buf, 'r')
    except zipfile.BadZipFile:
        return jsonify({"error": "Invalid zip file"}), 400
    base = Path(__file__).parent
    exercises_restored = 0
    images_restored = 0
    db_restored = False
    for name in zf.namelist():
        if name == "liftme.db":
            target = base / "data" / "liftme.db"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))
            db_restored = True
        elif name.startswith("exercises/") and not name.endswith("/"):
            target = base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))
            exercises_restored += 1
        elif name.startswith("images/") and not name.endswith("/"):
            target = base / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(name))
            images_restored += 1
        elif name == "settings.json":
            restored_settings = json.loads(zf.read(name))
            config.save_env(restored_settings)
    zf.close()
    if db_restored:
        init_db()
    return jsonify({
        "ok": True,
        "exercises": exercises_restored,
        "images": images_restored,
        "db_restored": db_restored,
    })


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
