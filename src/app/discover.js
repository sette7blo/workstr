// Discover exercises shared on the public relays and import them into the library.
// Reading Nostr is keyless, so Workstr queries the relays directly over WebSocket
// (the same REQ pattern vault.js uses for the private relay), then asks Idenstr
// only for the relay list. Imported images are localised into the DB per policy.
import { readRelays } from './idenstr.js';
import { localizeImage } from './images.js';
import { createExercise, getExercise, getExerciseByNostrAddress, markExercisePublished } from './store.js';
import { canonMuscle } from '../../public/muscles.js';

const DEFAULT_TIMEOUT_MS = 5000;
const D_PREFIX = 'workstr:exercise:';
// Known spam topics squatting on the shared 33401 kind; extend as new junk appears.
const NIP101E_NOISE_TAGS = new Set(['bikel', 'bikel-challenge', 'catallax']);
const MOVEMENT_TAGS = new Set([
  'squat', 'hinge', 'deadlift', 'lunge', 'row', 'press', 'pull', 'push', 'curl', 'extension',
  'rotation', 'isometric', 'carry', 'fly', 'raise', 'flexion', 'complex', 'getup', 'snatch',
  'clean', 'swing', 'jump', 'step', 'dip', 'crunch', 'bridge', 'kickback', 'thrust', 'twist'
]);

const RELAY_CONCURRENCY = 8;
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) { const i = cursor++; results[i] = await fn(items[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const slugify = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const tagValue = (tags, key) => (tags.find((t) => t[0] === key) || [])[1] || '';
const tagValues = (tags, key) => tags.filter((t) => t[0] === key && t.length >= 2).map((t) => t[1]);
const tagRow = (tags, key) => tags.find((t) => t[0] === key) || [];
const uniq = (values) => [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];

function isNip101eExerciseEvent(ev) {
  if (!ev || ev.kind !== 33401) return false;
  const tags = ev.tags || [];
  const topicTags = tagValues(tags, 't').map((t) => String(t).toLowerCase());
  if (topicTags.some((t) => NIP101E_NOISE_TAGS.has(t))) return false;
  if (!tagValue(tags, 'title')) return false;
  if (!tagValue(tags, 'd')) return false;
  if (!tagValue(tags, 'equipment')) return false;
  if (tagRow(tags, 'format').length < 2) return false;
  if (tagRow(tags, 'format_units').length < 2) return false;
  return true;
}

// Read back the exact granular recovery map Workstr stamped on its own 33401 events.
function workstrMuscles(tags) {
  const muscles = [];
  let primary = '';
  for (const row of tags) {
    if (row[0] !== 'workstr_muscle' || !row[1]) continue;
    const name = canonMuscle(row[1]) || row[1];
    if (!muscles.includes(name)) muscles.push(name);
    if (row[2] === 'primary') primary = name;
  }
  return { muscles, primary: primary || muscles[0] || '' };
}

function workstrMeta(tags) {
  const raw = tagValue(tags, 'workstr_meta');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// A Workstr-origin 33401 event re-imports losslessly: the recovery map and the fields
// with no standard home come straight back from the namespaced tags, no inference.
function fromWorkstrTemplate(ev, tags, meta) {
  const name = tagValue(tags, 'title');
  const dTag = tagValue(tags, 'd');
  const { muscles, primary } = workstrMuscles(tags);
  const media = imetaMedia(tags);
  const slug = dTag.startsWith(D_PREFIX) ? dTag.slice(D_PREFIX.length) : slugify(name);
  return {
    protocol: 'workstr',
    sourceLabel: 'Workstr',
    kind: 33401,
    slug,
    name,
    description: meta.description || '',
    category: meta.category || '',
    muscleGroup: primary,
    muscles,
    equipment: Array.isArray(meta.equipment) ? meta.equipment : [],
    difficulty: meta.difficulty || tagValue(tags, 'difficulty') || '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    instructions: Array.isArray(meta.instructions) && meta.instructions.length ? meta.instructions : instructionLines(ev.content, media.url),
    image: media.image,
    defaultSets: meta.defaultSets ?? 3,
    defaultReps: meta.defaultReps ?? '8-12',
    defaultRest: meta.defaultRest ?? 90,
    eventId: ev.id,
    pubkey: ev.pubkey,
    mediaUrl: media.url,
    address: `33401:${ev.pubkey}:${dTag}`,
    createdAt: ev.created_at
  };
}

function toNip101eExercise(ev) {
  if (!isNip101eExerciseEvent(ev)) return null;
  const tags = ev.tags || [];
  const meta = workstrMeta(tags);
  if (meta) return fromWorkstrTemplate(ev, tags, meta);
  const name = tagValue(tags, 'title');
  const dTag = tagValue(tags, 'd');
  const topics = uniq(tagValues(tags, 't').map((t) => String(t).toLowerCase()));
  const equipment = tagValue(tags, 'equipment');
  const difficulty = tagValue(tags, 'difficulty');
  const format = tagRow(tags, 'format').slice(1).map((x) => String(x).toLowerCase());
  const content = String(ev.content || '').trim();
  const media = imetaMedia(tags);
  const muscles = inferNip101eMuscles({ name, topics });
  if (!muscles.length) return null;
  const muscleGroup = muscles[0] || '';
  const movement = topics.find((t) => MOVEMENT_TAGS.has(t));
  const category = movement || 'strength';
  return {
    protocol: 'nip101e',
    sourceLabel: 'NIP-101e',
    kind: 33401,
    slug: slugify(name),
    name,
    description: content,
    category,
    muscleGroup,
    muscles,
    equipment: equipment ? [equipment] : [],
    difficulty,
    tags: topics,
    instructions: instructionLines(content, media.url),
    image: media.image,
    defaultSets: 3,
    defaultReps: format.includes('duration') && !format.includes('reps') ? '30s' : '8-12',
    defaultRest: 90,
    eventId: ev.id,
    pubkey: ev.pubkey,
    mediaUrl: media.url,
    address: `33401:${ev.pubkey}:${dTag}`,
    createdAt: ev.created_at
  };
}

function imetaMedia(tags) {
  for (const row of tags) {
    if (row[0] !== 'imeta') continue;
    for (const part of row.slice(1)) {
      const m = String(part).match(/^url\s+(.+)$/i);
      if (!m) continue;
      const url = m[1].trim();
      return { url, image: mediaThumbnail(url) || url };
    }
  }
  return { url: '', image: '' };
}

function mediaThumbnail(url) {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
    if (u.hostname.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      const embed = parts.findIndex((p) => ['embed', 'shorts', 'watch'].includes(p));
      if (embed >= 0 && parts[embed + 1]) return parts[embed + 1];
    }
  } catch {}
  return '';
}

function instructionLines(content, mediaUrl = '') {
  const lines = String(content || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (mediaUrl) lines.push(`Demo video: ${mediaUrl}`);
  return lines;
}

function inferNip101eMuscles({ name, topics }) {
  const lowerName = String(name || '').toLowerCase();
  const raw = new Set(topics);
  const has = (...needles) => needles.some((n) => raw.has(n) || lowerName.includes(n));
  const muscles = [];
  const add = (...items) => {
    for (const item of items) {
      const c = canonMuscle(item) || item;
      if (c && !muscles.includes(c)) muscles.push(c);
    }
  };

  if (has('calves', 'calf')) add('Calves');
  if (has('chest', 'pec', 'bench', 'push-up', 'pushup', 'fly')) add('Chest');
  if (raw.has('back') || has('lats', 'row', 'pull-up', 'pullup', 'chin-up', 'pulldown', 'shrug', 'traps')) add('Back');
  if (has('shoulders', 'shoulder', 'press', 'raise', 'pike', 'handstand')) add('Shoulders');
  if (has('biceps', 'bicep', 'curl', 'chin-up')) add('Biceps');
  if (has('triceps', 'tricep', 'extension', 'dip', 'skull')) add('Triceps');
  if (has('core', 'abs', 'abdominals', 'obliques', 'rotation', 'twist', 'crunch', 'plank', 'sit-up', 'v-up', 'hollow', 'dead bug', 'mountain climber')) add('Core');
  if (has('glutes', 'glute', 'bridge', 'thrust', 'kickback')) add('Glutes');
  if (has('hamstrings', 'hamstring', 'hinge', 'deadlift', 'leg curl', 'good morning')) add('Hamstrings');
  if (has('quadriceps', 'quads', 'legs', 'squat', 'lunge', 'step', 'leg press', 'leg extension', 'wall sit')) add('Quadriceps');

  // Add secondary recovery regions for compound movement patterns.
  if (has('squat', 'lunge', 'step', 'leg press')) add('Glutes', 'Hamstrings', 'Core');
  if (has('deadlift', 'hinge', 'good morning', 'swing')) add('Glutes', 'Back', 'Core');
  if (has('row', 'pull-up', 'pullup', 'chin-up', 'pulldown')) add('Biceps', 'Core');
  if (has('press', 'push-up', 'pushup', 'dip')) add('Triceps', 'Shoulders', 'Core');
  if (has('carry', 'farmer')) add('Back', 'Core', 'Biceps');
  if (has('full_body', 'full body', 'burpee', 'thruster', 'getup', 'snatch', 'clean')) add('Quadriceps', 'Glutes', 'Back', 'Shoulders', 'Core');

  const preferPrimary = (...candidates) => {
    for (const candidate of candidates) {
      const index = muscles.indexOf(candidate);
      if (index > 0) muscles.unshift(muscles.splice(index, 1)[0]);
      if (index >= 0) return;
    }
  };
  if (has('squat', 'lunge', 'step', 'leg press')) preferPrimary('Quadriceps');
  else if (has('deadlift', 'hinge', 'good morning', 'swing')) preferPrimary('Hamstrings', 'Glutes');
  else if (has('row', 'pull-up', 'pullup', 'chin-up', 'pulldown')) preferPrimary('Back');
  else if (has('push-up', 'pushup', 'bench', 'fly')) preferPrimary('Chest');
  else if (has('press', 'pike', 'handstand')) preferPrimary('Shoulders');
  else if (has('curl')) preferPrimary('Biceps');
  else if (has('extension', 'dip', 'skull')) preferPrimary('Triceps');

  return muscles;
}

function queryRelay(url, filter, timeoutMs) {
  return new Promise((resolve) => {
    const events = [];
    let socket = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket && socket.close(); } catch {}
      resolve(events);
    };
    const timer = setTimeout(finish, timeoutMs);
    try { socket = new WebSocket(url); } catch { return finish(); }
    const subId = `wkx-${Math.random().toString(36).slice(2, 10)}`;
    socket.addEventListener('open', () => socket.send(JSON.stringify(['REQ', subId, filter])));
    socket.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()); } catch { return; }
      if (msg[0] === 'EVENT' && msg[1] === subId) events.push(msg[2]);
      else if (msg[0] === 'EOSE' && msg[1] === subId) finish();
      else if (msg[0] === 'CLOSED' && msg[1] === subId) finish();
    });
    socket.addEventListener('error', finish);
    socket.addEventListener('close', finish);
  });
}

export async function discoverExercises({ muscle = '', limit = 80, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let relays;
  try { relays = await readRelays(); } catch (err) { return { configured: false, error: err.message, relays: [], exercises: [] }; }
  if (!relays.length) return { configured: false, relays: [], exercises: [] };

  // Exercises are discovered only as NIP-101e kind:33401 templates now; the legacy
  // kind:30078 exercise format is no longer read from relays. Workstr's own shared
  // exercises still appear here — they publish as 33401 (with workstr_meta) too.
  const batches = await mapWithConcurrency(relays, RELAY_CONCURRENCY, (relay) =>
    queryRelay(relay, { kinds: [33401], limit: Math.max(limit, 200) }, timeoutMs).then((events) => ({ relay, events })));

  // Dedup by coordinate, keeping the newest version of each shared exercise.
  const byAddress = new Map();
  for (const batch of batches) {
    for (const ev of batch.events) {
      const exercise = toNip101eExercise(ev);
      if (!exercise) continue;
      exercise.relay = batch.relay;
      const prev = byAddress.get(exercise.address);
      if (!prev || exercise.createdAt > prev.createdAt) byAddress.set(exercise.address, exercise);
    }
  }

  let exercises = [...byAddress.values()];
  if (muscle) {
    const m = muscle.toLowerCase();
    exercises = exercises.filter((e) => e.muscleGroup.toLowerCase() === m || e.muscles.some((x) => String(x).toLowerCase() === m));
  }
  // Flag the ones already in the library so the UI can show "imported".
  for (const e of exercises) e.imported = Boolean(getExerciseByNostrAddress(e.address));
  exercises.sort((a, b) => b.createdAt - a.createdAt);
  return { configured: true, relays, exercises };
}

export async function importExercise(data) {
  if (!data || !data.name) throw new Error('invalid exercise payload');
  if (data.address) {
    const existing = getExerciseByNostrAddress(data.address);
    if (existing) return { exercise: existing, duplicate: true };
  }
  const imageUrl = data.image ? await localizeImage(data.image) : '';
  const created = createExercise({
    name: data.name,
    slug: data.slug,
    description: data.description,
    category: data.category,
    muscleGroup: data.muscleGroup,
    muscles: data.muscles,
    equipment: data.equipment,
    difficulty: data.difficulty,
    tags: data.tags,
    instructions: data.instructions,
    imageUrl,
    defaultSets: data.defaultSets,
    defaultReps: data.defaultReps,
    defaultRest: data.defaultRest,
    sourceType: 'nostr'
  });
  markExercisePublished(created.slug, { eventId: data.eventId, pubkey: data.pubkey, address: data.address });
  return { exercise: getExercise(created.slug), duplicate: false };
}

export const __test = { isNip101eExerciseEvent, toNip101eExercise, inferNip101eMuscles };
