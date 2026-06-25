import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { getSheet, markSheetPublished, getSession, getExercise, markExercisePublished, markSessionSummary, getSetting } from './store.js';

const NOSTRBUILD_UPLOAD_URL = 'https://nostr.build/api/v2/nip96/upload';

// Weights are stored canonically in kg; the shared summary renders in the user's chosen unit.
const KG_TO_LB = 2.20462;

const root = fileURLToPath(new URL('../..', import.meta.url));
const envFile = process.env.WORKSTR_ENV_FILE ?? join(root, '.env');

// Scopes Workstr asks Idenstr for:
// - sign:kind:30078  → sign the private sheet event kept in the vault
// - publish:kind:1   → sign AND publish the workout summary note
// - sign:kind:27235  → NIP-98 auth header for nostr.build image uploads
// - publish:kind:30078 → sign AND broadcast a private sheet copy (legacy/sheets)
// - publish:kind:33401 → sign AND broadcast a shared exercise as a NIP-101e template
// - relays:read      → read the public relay list for discovery
export const REQUIRED_SCOPES = ['profile:read', 'relays:read', 'sign:kind:30078', 'sign:kind:33401', 'sign:kind:27235', 'publish:kind:1', 'publish:kind:30078', 'publish:kind:33401'];

let config = readConfig();

export function readConfig() {
  return {
    idenstrUrl: (process.env.WORKSTR_IDENSTR_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    idenstrToken: process.env.WORKSTR_IDENSTR_TOKEN ?? '',
    localRelayUrl: (process.env.WORKSTR_LOCAL_RELAY ?? '').replace(/\/$/, '')
  };
}

export function currentConfig() {
  return { idenstrUrl: config.idenstrUrl, tokenConfigured: Boolean(config.idenstrToken), localRelayUrl: config.localRelayUrl, requiredScopes: REQUIRED_SCOPES };
}

export async function saveConfig(body) {
  const updates = {};
  if ('idenstrUrl' in body) {
    const url = String(body.idenstrUrl ?? '').trim().replace(/\/$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('idenstrUrl must be an http:// or https:// URL');
    updates.WORKSTR_IDENSTR_URL = url;
  }
  if ('idenstrToken' in body && String(body.idenstrToken ?? '').trim()) {
    updates.WORKSTR_IDENSTR_TOKEN = String(body.idenstrToken).trim();
  }
  if ('localRelayUrl' in body) {
    const url = String(body.localRelayUrl ?? '').trim().replace(/\/$/, '');
    if (url && !/^wss?:\/\/[^\s]+$/i.test(url)) throw new Error('localRelayUrl must be a ws:// or wss:// URL');
    updates.WORKSTR_LOCAL_RELAY = url;
  }
  if (!Object.keys(updates).length) throw new Error('no updates');
  await updateEnvFile(updates);
  for (const [key, value] of Object.entries(updates)) process.env[key] = value;
  config = readConfig();
  return currentConfig();
}

async function updateEnvFile(updates) {
  let text = '';
  try { text = await readFile(envFile, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  const next = lines.map((line) => {
    if (!line || line.trimStart().startsWith('#') || !line.includes('=')) return line;
    const key = line.split('=', 1)[0].trim();
    if (!Object.hasOwn(updates, key)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!seen.has(key)) next.push(`${key}=${value}`);
  await writeFile(envFile, next.join('\n').replace(/\n*$/, '\n'));
}

async function idenstrFetch(path, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  const headers = {};
  if (config.idenstrToken) headers.Authorization = `Bearer ${config.idenstrToken}`;
  if (body) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.idenstrUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    let payload = null;
    try { payload = await response.json(); } catch {}
    return { ok: response.ok, status: response.status, body: payload };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Idenstr request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function status() {
  const out = { idenstrUrl: config.idenstrUrl, tokenConfigured: Boolean(config.idenstrToken), requiredScopes: REQUIRED_SCOPES };
  try {
    const health = await idenstrFetch('/api/v1/system/health');
    out.health = health.ok;
    const whoami = await idenstrFetch('/api/v1/whoami');
    const scopes = whoami.body?.principal?.scopes ?? [];
    out.grantedScopes = scopes;
    out.missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes('admin') && !scopes.includes(s));
    out.ok = Boolean(health.ok && whoami.ok && out.missingScopes.length === 0);
  } catch (err) {
    out.ok = false;
    out.error = err.message;
  }
  return out;
}

// Sign and store the workout sheet as a private kind:30078 event (NIP-78).
export async function publishSheet(sheetId) {
  const sheet = getSheet(sheetId);
  if (!sheet) throw new Error('sheet not found');
  if (!config.idenstrToken) throw new Error('Idenstr is not connected');
  const unsigned = {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `workstr:sheet:${sheet.id}`],
      ['title', sheet.name],
      ['client', 'workstr']
    ],
    content: JSON.stringify({
      v: 1,
      name: sheet.name,
      description: sheet.description,
      exercises: sheet.exercises.map((e) => ({ slug: e.exerciseSlug, name: e.exerciseName, sets: e.sets, reps: e.reps, restSec: e.restSec, weightKg: e.weight, notes: e.notes }))
    })
  };
  const res = await idenstrFetch('/api/v1/sign', { method: 'POST', body: unsigned });
  if (!res.ok) throw new Error(res.body?.error ? `${res.body.error}${res.body.required ? `: ${res.body.required}` : ''}` : `idenstr ${res.status}`);
  const eventId = res.body?.event?.id;
  if (eventId) markSheetPublished(sheet.id, eventId);
  return { event: res.body?.event, address: `30078:${unsigned.tags[0][1]}` };
}

// The public relays to read from for discovery. Idenstr owns the relay list
// (NIP-65); we read it rather than configuring relays in Workstr. Falls back to
// the write relays if no read relays are set.
export async function readRelays() {
  if (!config.idenstrToken) throw new Error('Idenstr is not connected');
  const res = await idenstrFetch('/api/v1/relays');
  if (!res.ok) throw new Error(res.body?.error ? `${res.body.error}` : `idenstr ${res.status}`);
  const read = Array.isArray(res.body?.read) ? res.body.read : [];
  const write = Array.isArray(res.body?.write) ? res.body.write : [];
  const relays = (read.length ? read : write).filter((u) => /^wss?:\/\//i.test(u));
  return [...new Set(relays)];
}

// --- Image upload (NIP-96 to nostr.build, authed with a NIP-98 event Idenstr signs) ---
// Workstr holds no keys, so Idenstr signs the kind:27235 auth event; Workstr does the
// HTTP upload. Mirrors Feedstr's media flow. The library stores images as DB data URLs,
// so we decode and upload a public copy at publish time.
async function createNip98Authorization(method, targetUrl, body) {
  const payload = createHash('sha256').update(body).digest('hex');
  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['u', targetUrl], ['method', method.toUpperCase()], ['payload', payload]]
  };
  const res = await idenstrFetch('/api/v1/sign', { method: 'POST', body: unsigned });
  if (!res.ok || !res.body?.event) throw new Error(res.body?.error ? `${res.body.error}${res.body.required ? `: ${res.body.required}` : ''}` : `idenstr ${res.status}`);
  return `Nostr ${Buffer.from(JSON.stringify(res.body.event), 'utf8').toString('base64')}`;
}

function extractNostrBuildUrls(payload, text) {
  const urls = new Set();
  const add = (value) => { if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) urls.add(value.trim()); };
  const walk = (value) => {
    if (!value) return;
    if (typeof value === 'string') return add(value);
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value === 'object') return Object.values(value).forEach(walk);
  };
  walk(payload?.data ?? payload);
  for (const match of String(text ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? []) add(match);
  return [...urls];
}

async function uploadImageToNostrBuild(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
  if (!m) throw new Error('exercise image is not an uploadable data URL');
  const mimeType = m[1];
  const fileBytes = Buffer.from(m[2], 'base64');
  const ext = (mimeType.split('/')[1] || 'jpg').split('+')[0];
  const boundary = `----workstr${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="exercise.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBytes, tail]);
  const auth = await createNip98Authorization('POST', NOSTRBUILD_UPLOAD_URL, body);
  const resp = await fetch(NOSTRBUILD_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body
  });
  const text = await resp.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!resp.ok) throw new Error(`nostr.build upload failed (HTTP ${resp.status}): ${payload?.message || text}`);
  const urls = extractNostrBuildUrls(payload, text);
  if (!urls.length) throw new Error('nostr.build did not return a media URL');
  return urls[0];
}

// --- NIP-101e exercise template (kind:33401) construction ---
// Workstr publishes its exercises as standard NIP-101e templates so other clients
// (POWR, etc.) can discover them, while carrying Workstr-only richness — the granular
// recovery muscle map and prefill defaults — in namespaced tags those clients ignore.
const EXERCISE_D_PREFIX = 'workstr:exercise:';
const NIP101E_EQUIPMENT = new Set(['barbell', 'dumbbell', 'bodyweight', 'machine', 'cardio']);

// Collapse Workstr's free-form equipment list to the single value 33401 requires.
function nip101eEquipment(list) {
  const arr = (list || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  const exact = arr.find((e) => NIP101E_EQUIPMENT.has(e));
  if (exact) return exact;
  for (const e of arr) {
    if (/dumbbell|kettlebell|\bdb\b|\bkb\b/.test(e)) return 'dumbbell';
    if (/barbell|\bbar\b/.test(e)) return 'barbell';
    if (/machine|cable|smith/.test(e)) return 'machine';
    if (/cardio|bike|treadmill|row|run/.test(e)) return 'cardio';
  }
  return arr[0] || 'bodyweight';
}

// Timed exercises log duration; everything else logs the standard strength quartet.
function nip101eFormat(ex) {
  const reps = String(ex.defaultReps || '').trim();
  const timed = ex.category === 'cardio' || /^\d+\s*(s|sec|secs|second|seconds|min|mins|minute|minutes)$/i.test(reps);
  return timed
    ? { format: ['duration', 'set_type'], units: ['seconds', 'warmup|normal|drop|failure'] }
    : { format: ['weight', 'reps', 'rpe', 'set_type'], units: ['kg', 'count', '0-10', 'warmup|normal|drop|failure'] };
}

function exerciseContent(ex) {
  const lines = [];
  if (ex.description) lines.push(String(ex.description).trim());
  for (const step of ex.instructions || []) if (step) lines.push(String(step).trim());
  return lines.join('\n');
}

// Build the unsigned kind:33401 event. Pure (no I/O) so it can be unit-tested.
export function buildExerciseTemplateEvent(ex, imageUrl = '') {
  const dTag = `${EXERCISE_D_PREFIX}${ex.slug}`;
  const { format, units } = nip101eFormat(ex);
  const tags = [
    ['d', dTag],
    ['title', ex.name],
    ['format', ...format],
    ['format_units', ...units],
    ['equipment', nip101eEquipment(ex.equipment)]
  ];
  if (ex.difficulty) tags.push(['difficulty', String(ex.difficulty).toLowerCase()]);
  if (imageUrl) tags.push(['imeta', `url ${imageUrl}`, 'm image/jpeg', `alt ${ex.name}`]);

  // Standard discovery hashtags every NIP-101e client understands.
  const hashtags = new Set();
  for (const m of ex.muscles || []) if (m) hashtags.add(String(m).toLowerCase());
  if (ex.category) hashtags.add(String(ex.category).toLowerCase());
  for (const t of ex.tags || []) if (t) hashtags.add(String(t).toLowerCase());
  for (const t of hashtags) tags.push(['t', t]);

  // Workstr identity — lets Workstr filter its own library out of the shared pool.
  tags.push(['t', 'workstr'], ['client', 'workstr']);

  // Granular recovery map (Workstr-only; ignored by other clients).
  const primary = ex.muscleGroup || (ex.muscles || [])[0] || '';
  for (const m of ex.muscles || []) if (m) tags.push(['workstr_muscle', m, m === primary ? 'primary' : 'secondary']);

  // Exact Workstr fields with no standard home, for lossless self re-import.
  tags.push(['workstr_meta', JSON.stringify({
    v: 1,
    description: ex.description || '',
    category: ex.category || '',
    equipment: ex.equipment || [],
    difficulty: ex.difficulty || '',
    tags: ex.tags || [],
    instructions: ex.instructions || [],
    defaultSets: ex.defaultSets,
    defaultReps: ex.defaultReps,
    defaultRest: ex.defaultRest
  })]);

  return { kind: 33401, created_at: Math.floor(Date.now() / 1000), tags, content: exerciseContent(ex) };
}

// Sign AND broadcast an exercise to the public relays so others can discover it.
// kind:33401 (NIP-101e), addressable by d-tag so re-publishing updates in place.
export async function publishExercise(slug) {
  const ex = getExercise(slug);
  if (!ex) throw new Error('exercise not found');
  if (!config.idenstrToken) throw new Error('Idenstr is not connected');

  let imageUrl = '';
  if (ex.imageUrl) {
    if (ex.imageUrl.startsWith('data:')) imageUrl = await uploadImageToNostrBuild(ex.imageUrl);
    else if (/^https?:\/\//i.test(ex.imageUrl)) imageUrl = ex.imageUrl;
  }

  const unsigned = buildExerciseTemplateEvent(ex, imageUrl);
  const dTag = unsigned.tags[0][1];
  const res = await idenstrFetch('/api/v1/events/publish', { method: 'POST', body: unsigned });
  if (!res.ok) throw new Error(res.body?.error ? `${res.body.error}${res.body.required ? `: ${res.body.required}` : ''}` : `idenstr ${res.status}`);
  const event = res.body?.event;
  const pubkey = event?.pubkey || '';
  const address = pubkey ? `33401:${pubkey}:${dTag}` : `33401:${dTag}`;
  if (event?.id) markExercisePublished(ex.slug, { eventId: event.id, pubkey, address });
  return { event, address, relayResults: res.body?.relayResults ?? [] };
}

// Build a human-readable summary and ask Idenstr to sign AND publish it (kind:1).
export async function shareSummary(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new Error('session not found');
  if (!config.idenstrToken) throw new Error('Idenstr is not connected');
  const text = summaryText(session);
  const unsigned = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'workout'], ['client', 'workstr']],
    content: text
  };
  const res = await idenstrFetch('/api/v1/events/publish', { method: 'POST', body: unsigned });
  if (!res.ok) throw new Error(res.body?.error ? `${res.body.error}${res.body.required ? `: ${res.body.required}` : ''}` : `idenstr ${res.status}`);
  if (res.body?.event?.id) markSessionSummary(session.id, res.body.event.id);
  return { event: res.body?.event, relayResults: res.body?.relayResults ?? [], text };
}

export function summaryText(session) {
  const done = session.sets.filter((s) => s.done);
  const unit = getSetting('weightUnit', 'kg');
  const toDisplay = (kg) => (unit === 'lbs' ? Math.round(Number(kg) * KG_TO_LB * 10) / 10 : Number(kg));
  const byExercise = new Map();
  for (const set of done) {
    const list = byExercise.get(set.exerciseSlug) ?? [];
    list.push(set);
    byExercise.set(set.exerciseSlug, list);
  }
  const volume = done.reduce((sum, s) => sum + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0);
  const lines = [`Workout: ${session.sheetName || 'Freestyle'}`];
  for (const [slug, sets] of byExercise) {
    const name = getExercise(slug)?.name ?? slug;
    const best = sets.reduce((a, b) => ((Number(b.weight) || 0) > (Number(a.weight) || 0) ? b : a), sets[0]);
    const top = best.weight == null ? '-' : `${toDisplay(best.weight)}${unit}`;
    lines.push(`• ${name}: ${sets.length} sets, top ${top} x ${best.reps ?? '-'}`);
  }
  lines.push(`Total volume: ${Math.round(toDisplay(volume))} ${unit}`);
  lines.push('#workout #fitness');
  return lines.join('\n');
}
