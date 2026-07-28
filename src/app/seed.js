// Browse yuhonas/free-exercise-db and import selected exercises into the local library.
// Mirrors Liftme's seed browser: fetch once, cache briefly, search/filter server-side,
// and copy chosen exercises into the local Workstr DB.
import { createExercise, getExercise } from './store.js';
import { localizeImage } from './images.js';

const EXERCISES_URL = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache = [];
let cacheTime = 0;
let fetchImpl = (...args) => globalThis.fetch(...args);

const slugify = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `ex-${Date.now()}`;
const title = (s) => String(s || '').split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

async function fetchAll() {
  if (cache.length && Date.now() - cacheTime < CACHE_TTL_MS) return cache;
  const res = await fetchImpl(EXERCISES_URL, { headers: { 'user-agent': 'workstr/1.0' } });
  if (!res.ok) throw new Error(`failed to fetch exercise database (${res.status})`);
  cache = await res.json();
  cacheTime = Date.now();
  return cache;
}

export async function browse({ q = '', category = '', muscle = '', equipment = '', level = '', limit = 60, offset = 0 } = {}) {
  const all = await fetchAll();
  const qLower = String(q || '').toLowerCase();
  const results = [];
  let total = 0;
  for (const ex of all) {
    if (qLower && !String(ex.name || '').toLowerCase().includes(qLower)) continue;
    if (category && String(ex.category || '').toLowerCase() !== String(category).toLowerCase()) continue;
    if (muscle) {
      const primary = (ex.primaryMuscles || []).map((m) => String(m).toLowerCase());
      const secondary = (ex.secondaryMuscles || []).map((m) => String(m).toLowerCase());
      if (![...primary, ...secondary].includes(String(muscle).toLowerCase())) continue;
    }
    if (equipment && String(ex.equipment || '').toLowerCase() !== String(equipment).toLowerCase()) continue;
    if (level && String(ex.level || '').toLowerCase() !== String(level).toLowerCase()) continue;
    total += 1;
    if (total > Number(offset) && results.length < Number(limit)) results.push(format(ex));
  }
  return { results, total };
}

export async function filters() {
  const all = await fetchAll();
  const categories = new Set();
  const muscles = new Set();
  const equipment = new Set();
  for (const ex of all) {
    if (ex.category) categories.add(ex.category);
    if (ex.equipment) equipment.add(ex.equipment);
    for (const m of [...(ex.primaryMuscles || []), ...(ex.secondaryMuscles || [])]) if (m) muscles.add(m);
  }
  return { categories: [...categories].sort(), muscles: [...muscles].sort(), equipment: [...equipment].sort() };
}

export async function getOne(seedId) {
  const all = await fetchAll();
  const raw = all.find((ex) => ex.id === seedId);
  return raw ? format(raw) : null;
}

export async function importExercise(seedId) {
  const ex = await getOne(seedId);
  if (!ex) return null;
  const existing = getExercise(ex.slug);
  if (existing) return { ...existing, alreadyExists: true };
  const imageUrl = await localizeImage(ex.image);
  return createExercise({
    slug: ex.slug,
    name: ex.name,
    description: ex.description,
    category: ex.category,
    muscleGroup: ex.muscleGroup,
    muscles: ex.muscles,
    equipment: ex.equipment,
    difficulty: ex.difficulty,
    tags: ex.tags,
    instructions: ex.instructions,
    imageUrl,
    defaultSets: ex.defaultSets,
    defaultReps: ex.defaultReps,
    defaultRest: ex.defaultRest,
    sourceType: 'seed'
  });
}

function format(ex) {
  const name = ex.name || '';
  const slug = slugify(name);
  const primary = ex.primaryMuscles || [];
  const secondary = ex.secondaryMuscles || [];
  const muscles = [...primary, ...secondary.filter((m) => !primary.includes(m))];
  const rawEquipment = ex.equipment || 'body only';
  const equipment = String(rawEquipment).toLowerCase() === 'body only' || !rawEquipment || String(rawEquipment).toLowerCase() === 'other'
    ? ['Body Weight']
    : [title(rawEquipment)];
  const difficultyMap = { beginner: 'beginner', intermediate: 'intermediate', expert: 'advanced' };
  const images = ex.images || [];
  return {
    seedId: ex.id,
    seed_id: ex.id,
    name,
    slug,
    description: '',
    category: ex.category || 'strength',
    muscleGroup: primary[0] ? title(primary[0]) : '',
    muscle_group: primary[0] ? title(primary[0]) : '',
    muscles: muscles.map(title),
    equipment,
    difficulty: difficultyMap[String(ex.level || 'beginner').toLowerCase()] || 'intermediate',
    level: ex.level || '',
    tags: [ex.force || '', ex.mechanic || ''].filter(Boolean),
    instructions: ex.instructions || [],
    defaultSets: 3,
    defaultReps: '8-12',
    defaultRest: 90,
    default_rest_sec: 90,
    image: images.length ? IMAGE_BASE + images[0] : '',
    imageUrl: images.length ? IMAGE_BASE + images[0] : '',
    sourceType: 'seed'
  };
}

export const __test = {
  setFetch(fn) { fetchImpl = fn; cache = []; cacheTime = 0; },
  reset() { fetchImpl = (...args) => globalThis.fetch(...args); cache = []; cacheTime = 0; },
  format
};
