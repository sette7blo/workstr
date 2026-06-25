import { prep } from './db.js';
import { canonMuscle } from '../../public/muscles.js';

const arr = (value) => { try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const slugify = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `ex-${Date.now()}`;
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---------- Exercises ----------

function rowToExercise(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    muscleGroup: row.muscle_group,
    muscles: arr(row.muscles),
    equipment: arr(row.equipment),
    difficulty: row.difficulty,
    tags: arr(row.tags),
    instructions: arr(row.instructions),
    imageUrl: row.image_url,
    favourite: Boolean(row.favourite),
    defaultSets: row.default_sets,
    defaultReps: row.default_reps,
    defaultRest: row.default_rest,
    sourceType: row.source_type,
    status: row.status,
    nostrEventId: row.nostr_event_id,
    nostrPubkey: row.nostr_pubkey,
    nostrAddress: row.nostr_address,
    nostrPublishedAt: row.nostr_published_at,
    updatedAt: row.updated_at
  };
}

export function listExercises({ status = 'active' } = {}) {
  return prep('SELECT * FROM exercises WHERE status = ? ORDER BY favourite DESC, name COLLATE NOCASE ASC').all(status).map(rowToExercise);
}

export function getExercise(slug) {
  return rowToExercise(prep('SELECT * FROM exercises WHERE slug = ?').get(slug));
}

export function createExercise(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name is required');
  let slug = slugify(body.slug || name);
  if (getExercise(slug)) slug = `${slug}-${Date.now().toString(36)}`;
  prep(`
    INSERT INTO exercises (slug, name, description, category, muscle_group, muscles, equipment, difficulty, tags, instructions, image_url, default_sets, default_reps, default_rest, source_type, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    slug, name, String(body.description || ''), String(body.category || ''), String(body.muscleGroup || ''),
    JSON.stringify(body.muscles || []), JSON.stringify(body.equipment || []), String(body.difficulty || ''),
    JSON.stringify(body.tags || []), JSON.stringify(body.instructions || []), String(body.imageUrl || ''),
    Number(body.defaultSets) || 3, String(body.defaultReps || '8-12'), Number(body.defaultRest) || 90,
    String(body.sourceType || 'manual'), now()
  );
  return getExercise(slug);
}

export function updateExercise(slug, body) {
  const existing = getExercise(slug);
  if (!existing) return null;
  prep(`
    UPDATE exercises SET name=?, description=?, category=?, muscle_group=?, muscles=?, equipment=?, difficulty=?, tags=?, instructions=?, image_url=?, default_sets=?, default_reps=?, default_rest=?, updated_at=?
    WHERE slug=?
  `).run(
    String(body.name ?? existing.name), String(body.description ?? existing.description), String(body.category ?? existing.category),
    String(body.muscleGroup ?? existing.muscleGroup), JSON.stringify(body.muscles ?? existing.muscles), JSON.stringify(body.equipment ?? existing.equipment),
    String(body.difficulty ?? existing.difficulty), JSON.stringify(body.tags ?? existing.tags), JSON.stringify(body.instructions ?? existing.instructions),
    String(body.imageUrl ?? existing.imageUrl), Number(body.defaultSets ?? existing.defaultSets), String(body.defaultReps ?? existing.defaultReps),
    Number(body.defaultRest ?? existing.defaultRest), now(), slug
  );
  return getExercise(slug);
}

// Record the Nostr coordinates after an exercise is published to (or imported
// from) public relays. Used to show the published badge / source on the card.
export function markExercisePublished(slug, { eventId, pubkey, address }) {
  prep(
    'UPDATE exercises SET nostr_event_id=?, nostr_pubkey=?, nostr_address=?, nostr_published_at=? WHERE slug=?'
  ).run(eventId || null, pubkey || null, address || null, now(), slug);
  return getExercise(slug);
}

// Find an already-imported exercise by its Nostr coordinate, to avoid duplicates
// when the same shared exercise is discovered again.
export function getExerciseByNostrAddress(address) {
  if (!address) return null;
  return rowToExercise(prep('SELECT * FROM exercises WHERE nostr_address = ? AND status = ?').get(address, 'active'));
}

export function setFavourite(slug, favourite) {
  prep('UPDATE exercises SET favourite=?, updated_at=? WHERE slug=?').run(favourite ? 1 : 0, now(), slug);
  return getExercise(slug);
}

// Hard-delete when nothing references the exercise so orphans never accumulate.
// Soft-delete (keep the row) only when a sheet or past session still points at the
// slug, so historical displays keep the readable name instead of a bare slug.
export function deleteExercise(slug) {
  if (!prep('SELECT 1 FROM exercises WHERE slug=?').get(slug)) return false;
  const refs = prep(
    'SELECT (SELECT COUNT(*) FROM sheet_exercises WHERE exercise_slug=?) + (SELECT COUNT(*) FROM session_sets WHERE exercise_slug=?) AS c'
  ).get(slug, slug).c;
  if (refs > 0) prep("UPDATE exercises SET status='deleted', updated_at=? WHERE slug=?").run(now(), slug);
  else prep('DELETE FROM exercises WHERE slug=?').run(slug);
  return true;
}

export function exerciseFilters() {
  const rows = listExercises();
  const categories = new Set(), muscles = new Set(), difficulties = new Set();
  for (const ex of rows) {
    if (ex.category) categories.add(ex.category);
    if (ex.difficulty) difficulties.add(ex.difficulty);
    // Offer the same canonical regions the Recovery map uses, derived from every
    // muscle an exercise touches (primary group + secondary movers).
    const cp = canonMuscle(ex.muscleGroup); if (cp) muscles.add(cp);
    for (const m of (ex.muscles || [])) { const c = canonMuscle(m); if (c) muscles.add(c); }
  }
  return {
    categories: [...categories].sort(),
    muscles: [...muscles].sort(),
    difficulties: [...difficulties].sort()
  };
}

// ---------- Sheets (workout templates) ----------

export function listSheets() {
  const sheets = prep('SELECT * FROM sheets WHERE is_temporary = 0 ORDER BY updated_at DESC').all();
  return sheets.map((s) => ({ ...sheetRow(s), exercises: sheetExercises(s.id) }));
}

function sheetRow(s) {
  return {
    id: s.id, name: s.name, description: s.description, isTemporary: Boolean(s.is_temporary),
    createdAt: s.created_at, updatedAt: s.updated_at,
    nostrEventId: s.nostr_event_id, nostrPublishedAt: s.nostr_published_at
  };
}

function sheetExercises(sheetId) {
  return prep(`
    SELECT se.*, e.name AS exercise_name, e.muscle_group AS muscle_group, e.image_url AS image_url
    FROM sheet_exercises se LEFT JOIN exercises e ON e.slug = se.exercise_slug
    WHERE se.sheet_id = ? ORDER BY se.position ASC, se.id ASC
  `).all(sheetId).map((r) => ({
    id: r.id, exerciseSlug: r.exercise_slug, exerciseName: r.exercise_name || r.exercise_slug,
    muscleGroup: r.muscle_group || '', imageUrl: r.image_url || '', position: r.position, sets: r.sets, reps: r.reps, restSec: r.rest_sec, weight: r.weight, notes: r.notes
  }));
}

export function getSheet(id) {
  const s = prep('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!s) return null;
  return { ...sheetRow(s), exercises: sheetExercises(s.id) };
}

export function createSheet(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name is required');
  const info = prep('INSERT INTO sheets (name, description, is_temporary, updated_at) VALUES (?, ?, ?, ?)').run(name, String(body.description || ''), body.isTemporary ? 1 : 0, now());
  const id = Number(info.lastInsertRowid);
  if (Array.isArray(body.exercises)) replaceSheetExercises(id, body.exercises);
  return getSheet(id);
}

export function updateSheet(id, body) {
  const sheet = getSheet(id);
  if (!sheet) return null;
  prep('UPDATE sheets SET name=?, description=?, updated_at=? WHERE id=?')
    .run(String(body.name ?? sheet.name), String(body.description ?? sheet.description), now(), id);
  if (Array.isArray(body.exercises)) replaceSheetExercises(id, body.exercises);
  // editing invalidates the published copy until re-published
  prep('UPDATE sheets SET nostr_published_at = NULL WHERE id = ? AND nostr_event_id IS NOT NULL').run(id);
  return getSheet(id);
}

function replaceSheetExercises(sheetId, exercises) {
  prep('DELETE FROM sheet_exercises WHERE sheet_id = ?').run(sheetId);
  const insert = prep('INSERT INTO sheet_exercises (sheet_id, exercise_slug, position, sets, reps, rest_sec, weight, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  exercises.forEach((ex, index) => {
    if (!ex || !ex.exerciseSlug) return;
    const weight = ex.weight == null || ex.weight === '' ? null : Number(ex.weight);
    insert.run(sheetId, String(ex.exerciseSlug), Number(ex.position ?? index), Number(ex.sets) || 3, String(ex.reps || '8-12'), Number(ex.restSec) || 90, Number.isFinite(weight) ? weight : null, String(ex.notes || ''));
  });
}

export function deleteSheet(id) {
  return prep('DELETE FROM sheets WHERE id = ?').run(id).changes > 0;
}

export function markSheetPublished(id, eventId) {
  prep('UPDATE sheets SET nostr_event_id=?, nostr_published_at=? WHERE id=?').run(eventId, now(), id);
}

// ---------- Sessions ----------

export function startSession(sheetId) {
  const sheet = sheetId ? getSheet(sheetId) : null;
  const info = prep('INSERT INTO sessions (sheet_id, sheet_name) VALUES (?, ?)').run(sheet?.id ?? null, sheet?.name ?? 'Freestyle');
  return getSession(Number(info.lastInsertRowid));
}

export function getSession(id) {
  const s = prep('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return null;
  const sets = prep('SELECT * FROM session_sets WHERE session_id = ? ORDER BY exercise_slug, set_number').all(id)
    .map((r) => ({ id: r.id, exerciseSlug: r.exercise_slug, setNumber: r.set_number, reps: r.reps, weight: r.weight, done: Boolean(r.done) }));
  return {
    id: s.id, sheetId: s.sheet_id, sheetName: s.sheet_name, startedAt: s.started_at, finishedAt: s.finished_at,
    notes: s.notes, summaryEventId: s.summary_event_id, sets
  };
}

export function logSet(sessionId, body) {
  if (!prep('SELECT id FROM sessions WHERE id = ?').get(sessionId)) throw new Error('session not found');
  prep('INSERT INTO session_sets (session_id, exercise_slug, set_number, reps, weight, done) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, String(body.exerciseSlug), Number(body.setNumber) || 1, body.reps == null ? null : Number(body.reps), body.weight == null ? null : Number(body.weight), body.done === false ? 0 : 1);
  return getSession(sessionId);
}

export function lastSetsForExercise(slug, beforeSessionId = null) {
  const current = beforeSessionId ? prep('SELECT started_at FROM sessions WHERE id = ?').get(beforeSessionId) : null;
  const session = current
    ? prep(`
        SELECT s.id FROM sessions s JOIN session_sets ss ON ss.session_id = s.id
        WHERE ss.exercise_slug = ? AND s.finished_at IS NOT NULL AND s.started_at < ?
        ORDER BY s.started_at DESC LIMIT 1
      `).get(slug, current.started_at)
    : prep(`
        SELECT s.id FROM sessions s JOIN session_sets ss ON ss.session_id = s.id
        WHERE ss.exercise_slug = ? AND s.finished_at IS NOT NULL
        ORDER BY s.started_at DESC LIMIT 1
      `).get(slug);
  if (!session) return [];
  return prep('SELECT set_number AS setNumber, reps, weight FROM session_sets WHERE session_id = ? AND exercise_slug = ? AND done = 1 ORDER BY set_number ASC').all(session.id, slug);
}

export function deleteSet(setId) {
  return prep('DELETE FROM session_sets WHERE id = ?').run(setId).changes > 0;
}

export function deleteSession(sessionId) {
  prep('DELETE FROM session_sets WHERE session_id = ?').run(sessionId);
  return prep('DELETE FROM sessions WHERE id = ?').run(sessionId).changes > 0;
}

export function finishSession(sessionId, notes = '') {
  prep('UPDATE sessions SET finished_at = ?, notes = ? WHERE id = ?').run(now(), String(notes || ''), sessionId);
  return getSession(sessionId);
}

export function markSessionSummary(sessionId, eventId) {
  prep('UPDATE sessions SET summary_event_id = ? WHERE id = ?').run(eventId, sessionId);
}

export function listSessions(limit = 50) {
  // Single grouped query instead of one aggregate per session (was 1 + N).
  return prep(`
    SELECT s.id, s.sheet_name, s.started_at, s.finished_at, s.notes, s.summary_event_id,
           COUNT(CASE WHEN ss.done = 1 THEN 1 END) AS sets,
           COALESCE(SUM(CASE WHEN ss.done = 1 THEN ss.reps * ss.weight END), 0) AS volume
    FROM sessions s
    LEFT JOIN session_sets ss ON ss.session_id = s.id
    WHERE s.finished_at IS NOT NULL
    GROUP BY s.id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(limit).map((s) => ({
    id: s.id, sheetName: s.sheet_name, startedAt: s.started_at, finishedAt: s.finished_at,
    notes: s.notes, setCount: s.sets, volume: Math.round(s.volume), shared: Boolean(s.summary_event_id)
  }));
}

export function activeSession() {
  const s = prep('SELECT id FROM sessions WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1').get();
  return s ? getSession(s.id) : null;
}

// ---------- Body log ----------

export function listBody(limit = 120) {
  return prep('SELECT * FROM body_log ORDER BY date DESC LIMIT ?').all(limit)
    .map((r) => ({ id: r.id, date: r.date, weightKg: r.weight_kg, notes: r.notes }));
}

export function logBody(body) {
  const date = String(body.date || new Date().toISOString().slice(0, 10));
  const weight = Number(body.weightKg);
  if (!Number.isFinite(weight)) throw new Error('weightKg must be a number');
  prep(`
    INSERT INTO body_log (date, weight_kg, notes) VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg, notes = excluded.notes
  `).run(date, weight, String(body.notes || ''));
  return listBody();
}

export function deleteBody(id) {
  return prep('DELETE FROM body_log WHERE id = ?').run(id).changes > 0;
}

// ---------- Plan (weekly) ----------

export function listPlan() {
  return prep('SELECT * FROM plan ORDER BY date, slot').all()
    .map((r) => ({ id: r.id, date: r.date, slot: r.slot, sheetId: r.sheet_id, notes: r.notes }));
}

export function addPlan(body) {
  const info = prep('INSERT INTO plan (date, slot, sheet_id, notes) VALUES (?, ?, ?, ?)')
    .run(String(body.date), String(body.slot || 'morning'), body.sheetId ? Number(body.sheetId) : null, String(body.notes || ''));
  return Number(info.lastInsertRowid);
}

export function deletePlan(id) {
  return prep('DELETE FROM plan WHERE id = ?').run(id).changes > 0;
}

// ---------- Mesocycles ----------

export function listMesocycles() {
  return prep('SELECT * FROM mesocycles ORDER BY start_date DESC').all()
    .map((r) => ({ id: r.id, name: r.name, goal: r.goal, startDate: r.start_date, weeks: r.weeks, notes: r.notes }));
}

export function createMesocycle(body) {
  const info = prep('INSERT INTO mesocycles (name, goal, start_date, weeks, notes) VALUES (?, ?, ?, ?, ?)')
    .run(String(body.name || 'Block'), String(body.goal || 'hypertrophy'), String(body.startDate || new Date().toISOString().slice(0, 10)), Number(body.weeks) || 4, String(body.notes || ''));
  return Number(info.lastInsertRowid);
}

export function deleteMesocycle(id) {
  return prep('DELETE FROM mesocycles WHERE id = ?').run(id).changes > 0;
}

// ---------- Settings ----------

export function getSetting(key, fallback = null) {
  const row = prep('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  prep('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// ---------- Stats ----------

export function getStats() {
  const totalSessions = prep('SELECT COUNT(*) AS n FROM sessions WHERE finished_at IS NOT NULL').get().n;
  const totalSets = prep('SELECT COUNT(*) AS n FROM session_sets WHERE done = 1').get().n;
  const totalVolume = Math.round(prep('SELECT COALESCE(SUM(reps*weight),0) AS v FROM session_sets WHERE done = 1').get().v);

  // Weekly volume (last 8 weeks)
  const weekly = prep(`
    SELECT strftime('%Y-%W', started_at) AS week, COALESCE(SUM(ss.reps*ss.weight),0) AS volume
    FROM sessions s JOIN session_sets ss ON ss.session_id = s.id
    WHERE s.finished_at IS NOT NULL AND ss.done = 1
    GROUP BY week ORDER BY week DESC LIMIT 8
  `).all().map((r) => ({ week: r.week, volume: Math.round(r.volume) })).reverse();

  // Muscle distribution by sets
  const muscle = prep(`
    SELECT COALESCE(NULLIF(e.muscle_group,''),'Other') AS muscle, COUNT(*) AS sets
    FROM session_sets ss JOIN exercises e ON e.slug = ss.exercise_slug
    WHERE ss.done = 1 GROUP BY muscle ORDER BY sets DESC
  `).all().map((r) => ({ muscle: r.muscle, sets: r.sets }));

  // Personal records: best estimated 1RM (Epley) per exercise
  const prs = prep(`
    SELECT ss.exercise_slug AS slug, e.name AS name,
           MAX(ss.weight * (1 + ss.reps / 30.0)) AS e1rm, MAX(ss.weight) AS top_weight
    FROM session_sets ss JOIN exercises e ON e.slug = ss.exercise_slug
    WHERE ss.done = 1 AND ss.weight IS NOT NULL AND ss.reps IS NOT NULL AND ss.weight > 0
    GROUP BY ss.exercise_slug ORDER BY e1rm DESC LIMIT 12
  `).all().map((r) => ({ slug: r.slug, name: r.name, e1rm: Math.round(r.e1rm * 10) / 10, topWeight: r.top_weight }));

  return { totalSessions, totalSets, totalVolume, weekly, muscle, prs, streak: computeStreak() };
}

// ---------- muscle recovery ----------
// Base recovery hours per canonical muscle group (larger groups recover slower).
const RECOVERY_CONFIG = {
  Chest: 72, Back: 72, Shoulders: 48, Biceps: 36, Triceps: 36,
  Core: 48, Quadriceps: 72, Hamstrings: 72, Glutes: 48, Calves: 36
};
// Scale the recovery window by how much the muscle was actually worked. Muscles
// that only appear as a secondary mover in one compound (≈0.5–1.5 effective sets)
// shouldn't read as heavily fatigued as a directly-trained primary.
function volumeMultiplier(sets) {
  if (sets < 2) return 0.4;   // barely involved (e.g. a single compound's synergist)
  if (sets < 6) return 0.7;   // light direct work, or secondary across a few lifts
  if (sets <= 12) return 1.0; // a solid primary session
  return 1.2;                 // high volume — extended recovery
}

export function getRecovery() {
  const rows = prep(`
    SELECT ws.finished_at AS finished_at, e.muscle_group AS muscle_group, e.muscles AS muscles
    FROM session_sets wss
    JOIN sessions ws ON wss.session_id = ws.id
    LEFT JOIN exercises e ON wss.exercise_slug = e.slug
    WHERE ws.finished_at IS NOT NULL
      AND ws.finished_at >= datetime('now', '-10 days')
      AND wss.done = 1
    ORDER BY ws.finished_at DESC
  `).all();

  const now = Date.now();
  // finished_at -> { canonicalMuscle -> setCount (primary=1, secondary=0.5) }
  const sessionVolumes = new Map();
  for (const row of rows) {
    if (!row.finished_at) continue;
    if (!sessionVolumes.has(row.finished_at)) sessionVolumes.set(row.finished_at, {});
    const sv = sessionVolumes.get(row.finished_at);
    const primary = canonMuscle(row.muscle_group);
    if (primary) sv[primary] = (sv[primary] || 0) + 1;
    let muscles = [];
    try { muscles = JSON.parse(row.muscles || '[]'); } catch {}
    for (const m of muscles) {
      const c = canonMuscle(m);
      if (c && c !== primary) sv[c] = (sv[c] || 0) + 0.5;
    }
  }
  const sortedSessions = [...sessionVolumes.keys()].sort().reverse();
  const ms = (s) => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();

  const groups = [];
  for (const [muscle, baseHours] of Object.entries(RECOVERY_CONFIG)) {
    let lastTrained = null;
    let totalSets = 0;
    for (const finishedAt of sortedSessions) {
      const sv = sessionVolumes.get(finishedAt);
      if (!(muscle in sv)) continue;
      if (lastTrained === null) { lastTrained = finishedAt; totalSets = sv[muscle]; }
      else if ((ms(lastTrained) - ms(finishedAt)) / 3600000 <= baseHours) totalSets += sv[muscle];
    }
    if (lastTrained === null) {
      groups.push({ name: muscle, percent: 100, status: 'untrained', lastTrained: null, hoursRemaining: 0, totalSets: 0 });
      continue;
    }
    const hoursElapsed = (now - ms(lastTrained)) / 3600000;
    const adjustedHours = baseHours * volumeMultiplier(totalSets);
    const percent = Math.min(100, Math.round((hoursElapsed / adjustedHours) * 100));
    const hoursRemaining = Math.max(0, Math.round((adjustedHours - hoursElapsed) * 10) / 10);
    const status = percent >= 80 ? 'ready' : percent >= 50 ? 'partial' : 'recovering';
    groups.push({ name: muscle, percent, status, lastTrained, hoursRemaining, totalSets: Math.round(totalSets) });
  }

  const trained = groups.filter((g) => g.status !== 'untrained');
  const overallReadiness = trained.length ? Math.round(trained.reduce((a, g) => a + g.percent, 0) / trained.length) : 100;
  const readyCount = groups.filter((g) => g.status === 'ready' || g.status === 'untrained').length;
  return { muscleGroups: groups, overallReadiness, readyCount, totalCount: groups.length };
}

// Build a workout from exercises targeting recovered muscle groups. Returns the
// selected exercises plus a per-muscle pool for client-side swapping. Mirrors Liftme.
export function getQuickWorkout(durationMinutes = 45, minRecovery = 80) {
  const recovery = getRecovery();
  const readySet = new Set(recovery.muscleGroups.filter((mg) => mg.percent >= minRecovery).map((mg) => mg.name));
  if (!readySet.size) return { exercises: [], pool: {}, targetMuscleGroups: [], estimatedDurationMin: 0 };

  // No image_url here on purpose: the list UI doesn't render thumbnails and the session
  // resolves images by slug, so shipping per-exercise base64 images would bloat the payload.
  const rows = prep("SELECT slug, name, muscle_group, tags FROM exercises WHERE status='active' AND muscle_group IS NOT NULL AND muscle_group != '' ORDER BY name COLLATE NOCASE ASC")
    .all().filter((r) => readySet.has(canonMuscle(r.muscle_group)));
  const loggedSlugs = new Set(prep('SELECT DISTINCT exercise_slug FROM session_sets').all().map((r) => r.exercise_slug));

  // Score (logged-before + compound) and bucket exercises by canonical muscle group.
  const byMuscle = {};
  for (const r of rows) {
    const mg = canonMuscle(r.muscle_group);
    let tags = []; try { tags = JSON.parse(r.tags || '[]'); } catch {}
    const score = (loggedSlugs.has(r.slug) ? 1 : 0) + (tags.map((t) => String(t).toLowerCase()).includes('compound') ? 1 : 0);
    (byMuscle[mg] ||= []).push({ slug: r.slug, name: r.name, muscleGroup: mg, sets: 3, reps: '8-12', restSec: 90, score });
  }
  for (const mg of Object.keys(byMuscle)) byMuscle[mg].sort((a, b) => b.score - a.score);

  // Round-robin across muscle groups so the workout is balanced, up to the time budget.
  const minPerExercise = 9; // ~3 sets x 3 min
  const maxExercises = Math.max(1, Math.floor(durationMinutes / minPerExercise));
  const pools = {}; for (const mg of Object.keys(byMuscle)) pools[mg] = [...byMuscle[mg]];
  const keys = Object.keys(pools);
  const strip = ({ score, ...rest }) => rest;
  const selected = [];
  let idx = 0;
  while (selected.length < maxExercises) {
    if (!keys.some((k) => pools[k].length)) break;
    const mg = keys[idx % keys.length];
    if (pools[mg] && pools[mg].length) selected.push(strip(pools[mg].shift()));
    idx++;
  }
  const poolOut = {};
  for (const mg of keys) { const clean = pools[mg].map(strip); if (clean.length) poolOut[mg] = clean; }
  return {
    exercises: selected,
    pool: poolOut,
    targetMuscleGroups: [...new Set(selected.map((e) => e.muscleGroup))],
    estimatedDurationMin: selected.length * minPerExercise
  };
}

function computeStreak() {
  const dates = prep("SELECT DISTINCT date(started_at) AS d FROM sessions WHERE finished_at IS NOT NULL ORDER BY d DESC").all().map((r) => r.d);
  if (!dates.length) return 0;
  let streak = 0;
  const cursor = new Date();
  // allow today or yesterday to start the streak
  const newest = new Date(dates[0]);
  const dayMs = 86400000;
  if (Math.round((stripTime(cursor) - stripTime(newest)) / dayMs) > 1) return 0;
  let expect = stripTime(newest);
  for (const d of dates) {
    const day = stripTime(new Date(d));
    if (day === expect) { streak += 1; expect -= dayMs; }
    else if (day < expect) break;
  }
  return streak;
}

function stripTime(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dashboard() {
  return {
    exercises: prep("SELECT COUNT(*) AS n FROM exercises WHERE status='active'").get().n,
    sheets: prep('SELECT COUNT(*) AS n FROM sheets').get().n,
    sessions: prep('SELECT COUNT(*) AS n FROM sessions WHERE finished_at IS NOT NULL').get().n,
    stats: getStats(),
    recentSessions: listSessions(5),
    latestBody: listBody(1)[0] ?? null
  };
}
