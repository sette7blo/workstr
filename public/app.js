import { canonMuscle as detailCanonMuscle } from './muscles.js?v=13';

const state = { exercises: [], sheets: [], filters: { categories: [], muscles: [], difficulties: [] }, unit: 'kg', activeSession: null };
let sessionExerciseIndex = 0;
let sessionSetCounts = {};
let sessionRestTimer = null;
let sessionRestTotal = 0;
let sessionRestRemaining = 0;
let sessionElapsedTimer = null;
let sessionWakeLock = null;
let sessionNoSleepVideo = null;
let sessionPRbaseline = {};
let sessionPRs = [];
const sessionPreviousSets = new Map();

// ---------- core helpers ----------
async function api(path, options = {}) {
  const response = await fetch(`./api/v1/${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try { const b = await response.json(); detail = b.required ? `${b.error}: ${b.required}` : (b.error || b.message || detail); } catch {}
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const difficultyBadgeClass = (difficulty) => ({
  beginner: 'diff-beginner',
  intermediate: 'diff-intermediate',
  advanced: 'diff-advanced'
}[String(difficulty || '').trim().toLowerCase()] || 'diff-unknown');
// Weights are stored canonically in kg; these convert to/from the chosen display unit.
const KG_TO_LB = 2.20462;
const unitLabel = () => state.unit;
const wDisplay = (kg) => (kg == null || kg === '' || !Number.isFinite(Number(kg))) ? null : (state.unit === 'lbs' ? Math.round(Number(kg) * KG_TO_LB * 10) / 10 : Number(kg));
const wStore = (val) => (val == null || val === '' || !Number.isFinite(Number(val))) ? null : (state.unit === 'lbs' ? Math.round(Number(val) / KG_TO_LB * 10) / 10 : Number(val));
const wFmt = (kg) => { const v = wDisplay(kg); return v == null ? '' : `${v}${state.unit}`; };

let toastTimer = null;
function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

async function withButtonState(button, fn) {
  if (!button) return fn();
  const label = button.textContent;
  button.disabled = true;
  button.classList.add('busy');
  button.textContent = 'Working...';
  try {
    const result = await fn();
    button.textContent = 'Done';
    return result;
  } catch (error) {
    button.textContent = 'Failed';
    toast(error.message || String(error), 'bad');
    throw error;
  } finally {
    setTimeout(() => { button.textContent = label; button.disabled = false; button.classList.remove('busy'); }, 1000);
  }
}

function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.add('open');
}
function closeModal() { $('#modal').classList.remove('open'); $('#modal-body').innerHTML = ''; }

// ---------- navigation ----------
let currentTab = 'exercises';
const subState = { exercises: 'library', workouts: 'programs', statistics: 'training' };

function switchTab(tab) {
  if (!document.getElementById('page-' + tab)) tab = 'exercises';
  currentTab = tab;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.tab === tab));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + tab));
  const sub = subState[tab] || null;
  applySubTab(tab, sub);
  loadTab(tab, sub);
}

function switchSubTab(tab, sub) {
  subState[tab] = sub;
  if (currentTab !== tab) return switchTab(tab);
  applySubTab(tab, sub);
  loadTab(tab, sub);
}

function applySubTab(tab, sub) {
  if (!sub) return;
  const page = document.getElementById('page-' + tab);
  if (!page) return;
  $$('.sub-tab', page).forEach((t) => t.classList.toggle('active', t.dataset.subtab === sub));
  $$('.sub-panel', page).forEach((p) => p.classList.toggle('active', p.id === `sub-${tab}-${sub}`));
}

function goTo(tab, sub) { if (sub) subState[tab] = sub; switchTab(tab); }

async function loadTab(tab, sub) {
  try {
    if (tab === 'exercises') return sub === 'discover' ? loadDiscover() : loadExercises();
    if (tab === 'workouts') {
      if (sub === 'recovery') return loadRecovery();
      if (sub === 'history') return loadHistory();
      return loadPrograms();
    }
    if (tab === 'statistics') return loadProgress();
    if (tab === 'settings') return loadConnect();
  } catch (error) { toast(error.message, 'bad'); }
}

// ---------- exercises ----------
async function loadExercises() {
  const [{ exercises }, filters] = await Promise.all([api('exercises'), api('exercises/filters')]);
  state.exercises = exercises;
  state.filters = filters;
  fillSelect($('#ex-cat'), filters.categories, 'All categories');
  fillSelect($('#ex-muscle'), filters.muscles, 'All muscles');
  fillSelect($('#ex-diff'), filters.difficulties, 'All levels');
  renderExercises();
}

function fillSelect(select, values, allLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}

// Every canonical recovery region an exercise touches (primary group + all listed muscles),
// so the muscle filter matches exactly what the Recovery map attributes to that exercise.
function exerciseCanonMuscles(e) {
  const set = new Set();
  const p = detailCanonMuscle(e.muscleGroup); if (p) set.add(p);
  (e.muscles || []).forEach((m) => { const c = detailCanonMuscle(m); if (c) set.add(c); });
  return set;
}

function renderExercises() {
  const q = $('#ex-search').value.trim().toLowerCase();
  const cat = $('#ex-cat').value, muscle = $('#ex-muscle').value, diff = $('#ex-diff').value;
  const list = state.exercises.filter((e) =>
    (!q || e.name.toLowerCase().includes(q) || e.muscleGroup.toLowerCase().includes(q)) &&
    (!cat || e.category === cat) && (!muscle || exerciseCanonMuscles(e).has(muscle)) && (!diff || e.difficulty === diff));
  const hasFilters = Boolean(q || cat || muscle || diff);
  $('#ex-empty').style.display = list.length ? 'none' : 'block';
  $('#ex-empty').textContent = state.exercises.length === 0 && !hasFilters
    ? 'Your exercise library is empty. Create an exercise manually or discover exercises from relays.'
    : 'No exercises match.';
  $('#ex-grid').innerHTML = list.map(exerciseCardHtml).join('');
}

const EX_PLACEHOLDER = `<div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;

function exerciseImageSrc(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('/')) return url;
  return `/${url}`;
}

// Read an image file and downscale it to a compact JPEG data URL so the picture
// can live directly in the DB without bloating list payloads.
function fileToDataUrl(file, maxDim = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function exerciseCardHtml(e) {
  const src = exerciseImageSrc(e.imageUrl);
  // Placeholder icon sits behind the photo; if the photo is absent or 404s it shows through.
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const source = e.sourceType === 'ai' ? 'ai' : e.sourceType === 'nostr' ? 'nostr' : 'manual';
  const sourceCls = source === 'ai' ? 'badge-ai' : source === 'nostr' ? 'badge-nostr' : 'badge-manual';
  const diffCls = difficultyBadgeClass(e.difficulty);
  return `
    <div class="ex-card" data-slug="${escapeHtml(e.slug)}">
      <div class="card-img">
        ${img}
        <span class="source-badge ${sourceCls}">${escapeHtml(source)}</span>
        ${e.nostrEventId ? '<span class="published-badge" title="Shared on relays">shared</span>' : ''}
        ${e.difficulty ? `<span class="diff-badge ${diffCls}">${escapeHtml(e.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(e.name)}<button class="fav ${e.favourite ? 'on' : ''}" data-fav="${escapeHtml(e.slug)}" title="Favourite">${e.favourite ? '★' : '☆'}</button></div>
        <div class="card-meta">
          ${e.muscleGroup ? `<span class="muscle">${escapeHtml(e.muscleGroup)}</span>` : ''}
          ${e.category ? `<span class="card-tag">${escapeHtml(e.category)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function exerciseFormHtml(e = {}) {
  return `
    <h3>${e.slug ? 'Edit exercise' : 'New exercise'}</h3>
    <form id="ex-form" class="form-grid">
      <label class="span-2">Name<input name="name" value="${escapeHtml(e.name || '')}" required /></label>
      <label>Category<input name="category" value="${escapeHtml(e.category || '')}" placeholder="strength" /></label>
      <label>Muscle group<input name="muscleGroup" value="${escapeHtml(e.muscleGroup || '')}" placeholder="Chest" /></label>
      <label>Difficulty<input name="difficulty" value="${escapeHtml(e.difficulty || '')}" placeholder="beginner" /></label>
      <label>Equipment (comma)<input name="equipment" value="${escapeHtml((e.equipment || []).join(', '))}" placeholder="Barbell" /></label>
      <div class="span-2 image-field">
        <span class="field-label">Image</span>
        <div class="image-upload">
          <div class="image-preview" id="ex-image-preview">${e.imageUrl ? `<img src="${escapeHtml(exerciseImageSrc(e.imageUrl))}" alt="">` : '<span>No image</span>'}</div>
          <div class="image-actions">
            <label class="button" for="ex-image-file">Upload picture</label>
            <input type="file" id="ex-image-file" accept="image/*" hidden />
            <button type="button" class="button ghost" id="ex-image-remove"${e.imageUrl ? '' : ' hidden'}>Remove</button>
          </div>
        </div>
        <input type="hidden" name="imageUrl" value="${escapeHtml(e.imageUrl || '')}" />
      </div>
      <label>Default sets<input name="defaultSets" type="number" value="${e.defaultSets ?? 3}" /></label>
      <label>Default reps<input name="defaultReps" value="${escapeHtml(e.defaultReps || '8-12')}" /></label>
      <label>Default rest (sec)<input name="defaultRest" type="number" value="${e.defaultRest ?? 90}" /></label>
      <label class="span-2">Instructions (one per line)<textarea name="instructions" rows="3">${escapeHtml((e.instructions || []).join('\n'))}</textarea></label>
      <div class="form-actions span-2">
        <button class="button primary" type="submit">${e.slug ? 'Save' : 'Create'}</button>
        ${e.slug ? `<button class="button danger" type="button" id="ex-delete">Delete</button>` : ''}
      </div>
    </form>`;
}

function exerciseFormPayload(form) {
  return {
    name: form.name.value, category: form.category.value, muscleGroup: form.muscleGroup.value, difficulty: form.difficulty.value,
    equipment: form.equipment.value.split(',').map((s) => s.trim()).filter(Boolean),
    muscles: form.muscleGroup.value ? [form.muscleGroup.value] : [],
    defaultSets: Number(form.defaultSets.value) || 3, defaultReps: form.defaultReps.value, defaultRest: Number(form.defaultRest.value) || 90,
    imageUrl: form.imageUrl.value.trim(),
    instructions: form.instructions.value.split('\n').map((s) => s.trim()).filter(Boolean)
  };
}

function openExerciseModal(existing = null) {
  openModal(exerciseFormHtml(existing || {}));
  const form = $('#ex-form');
  const fileInput = $('#ex-image-file');
  const preview = $('#ex-image-preview');
  const removeBtn = $('#ex-image-remove');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      form.imageUrl.value = dataUrl;
      preview.innerHTML = `<img src="${dataUrl}" alt="">`;
      removeBtn.hidden = false;
    } catch { toast('Could not read that image'); }
  });
  removeBtn.addEventListener('click', () => {
    form.imageUrl.value = '';
    fileInput.value = '';
    preview.innerHTML = '<span>No image</span>';
    removeBtn.hidden = true;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await withButtonState(form.querySelector('button[type=submit]'), async () => {
      if (existing) await api(`exercises/${encodeURIComponent(existing.slug)}`, { method: 'PUT', body: JSON.stringify(exerciseFormPayload(form)) });
      else await api('exercises', { method: 'POST', body: JSON.stringify(exerciseFormPayload(form)) });
      closeModal(); toast('Exercise saved'); await loadExercises();
    });
  });
  if (existing) $('#ex-delete').addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => { await api(`exercises/${encodeURIComponent(existing.slug)}`, { method: 'DELETE' }); closeModal(); toast('Exercise deleted'); await loadExercises(); });
  });
}

// Clone the recovery body SVG into `host`, tinting the given canonical muscle regions.
function buildBodyMapInto(host, primarySet, secondarySet) {
  const src = $('#recovery-body');
  if (!host || !src) return;
  const svg = src.cloneNode(true);
  svg.removeAttribute('id');
  svg.querySelectorAll('text').forEach((t) => t.remove());
  svg.querySelectorAll('polygon').forEach((el) => {
    const m = el.dataset.muscle;
    if (!m) { el.style.fill = '#1a1228'; el.style.opacity = ''; return; }
    if (primarySet.has(m)) { el.style.fill = 'var(--sovereign-purple)'; el.style.opacity = '0.95'; }
    else if (secondarySet.has(m)) { el.style.fill = 'var(--purple-2)'; el.style.opacity = '0.5'; }
    else { el.style.fill = '#2a1d40'; el.style.opacity = ''; }
  });
  host.innerHTML = '';
  host.appendChild(svg);
}

function renderDetailMuscleMap(primaryGroup, muscles) {
  const primary = detailCanonMuscle(primaryGroup) || primaryGroup;
  const primarySet = new Set(primary ? [primary] : []);
  const secondarySet = new Set((muscles || []).map(detailCanonMuscle).filter((c) => c && c !== primary));
  buildBodyMapInto($('#detail-muscle-map'), primarySet, secondarySet);
}

function openExerciseDetail(slug) {
  const e = state.exercises.find((x) => x.slug === slug);
  if (!e) return;
  const src = exerciseImageSrc(e.imageUrl);
  const muscles = (e.muscles || []).filter(Boolean);
  const equipment = (e.equipment || []).filter(Boolean);
  const tags = (e.tags || []).filter(Boolean);
  const pills = (list) => list.map((x) => `<span class="tag-pill">${escapeHtml(x)}</span>`).join('');
  const muscleList = muscles.length ? muscles : (e.muscleGroup ? [e.muscleGroup] : []);
  openModal(`
    <div class="detail-img${src ? '' : ' placeholder'}">${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()">` : EX_PLACEHOLDER}</div>
    <h3 class="detail-title">${escapeHtml(e.name)}</h3>
    <div class="detail-badges">
      ${e.difficulty ? `<span class="badge diff">${escapeHtml(e.difficulty)}</span>` : ''}
      ${e.category ? `<span class="badge cat">${escapeHtml(e.category)}</span>` : ''}
      <span class="badge">${escapeHtml(e.sourceType === 'ai' ? 'ai' : e.sourceType === 'nostr' ? 'nostr' : 'manual')}</span>
      ${e.nostrEventId ? '<span class="badge published">published</span>' : ''}
    </div>
    ${e.nostrAddress ? `<p class="detail-nostr" title="${escapeHtml(e.nostrAddress)}">Shared on relays · <code>${escapeHtml(e.nostrAddress)}</code></p>` : ''}
    ${e.description ? `<p class="detail-desc">${escapeHtml(e.description)}</p>` : ''}
    <div class="sets-info">
      <div class="sets-item"><div class="val">${e.defaultSets ?? 3}</div><div class="lbl">Sets</div></div>
      <div class="sets-item"><div class="val">${escapeHtml(e.defaultReps || '8-12')}</div><div class="lbl">Reps</div></div>
      <div class="sets-item"><div class="val">${e.defaultRest ?? 90}s</div><div class="lbl">Rest</div></div>
    </div>
    ${muscleList.length ? `<div class="subsection-head"><span>Target muscles</span></div><div class="tag-row">${pills(muscleList)}</div><div id="detail-muscle-map" class="detail-muscle-map"></div>` : ''}
    ${equipment.length ? `<div class="subsection-head"><span>Equipment</span></div><div class="tag-row">${pills(equipment)}</div>` : ''}
    ${tags.length ? `<div class="subsection-head"><span>Tags</span></div><div class="tag-row">${pills(tags)}</div>` : ''}
    ${(e.instructions || []).length ? `<div class="subsection-head"><span>Instructions</span></div><ol class="instruction-list">${e.instructions.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>` : ''}
    <div class="form-actions">
      <button class="button primary" id="ex-edit">Edit</button>
      <button class="button ghost" id="ex-publish">${e.nostrEventId ? 'Update on relays' : 'Publish to relays'}</button>
    </div>`);
  if (muscleList.length) renderDetailMuscleMap(e.muscleGroup, muscleList);
  $('#ex-edit').addEventListener('click', async () => openExerciseModal(await api(`exercises/${encodeURIComponent(e.slug)}`)));
  $('#ex-publish').addEventListener('click', (ev) => withButtonState(ev.currentTarget, async () => {
    await api(`exercises/${encodeURIComponent(e.slug)}/publish`, { method: 'POST' });
    toast('Published to relays');
    await loadExercises();
    openExerciseDetail(e.slug);
  }));
}

// ---------- discover (exercises shared on the public relays) ----------
let discoverResults = [];
let discoverBaseStatus = '';

async function loadDiscover() {
  const grid = $('#discover-grid');
  if (!grid || grid.dataset.loaded) return; // load once; refresh is manual
  await runDiscover();
}

async function runDiscover() {
  const grid = $('#discover-grid'); const status = $('#discover-status');
  if (!grid) return;
  status.textContent = 'Searching relays...';
  grid.innerHTML = '';
  try {
    const res = await api('discover/exercises');
    grid.dataset.loaded = '1';
    if (!res.configured) { status.textContent = res.error ? `Cannot reach relays: ${res.error}` : 'No relays are configured in Idenstr yet.'; discoverResults = []; discoverBaseStatus = ''; return; }
    discoverResults = res.exercises || [];
    const n = res.relays.length;
    if (!discoverResults.length) { status.textContent = `No shared exercises found on ${n} relay${n === 1 ? '' : 's'}.`; discoverBaseStatus = ''; return; }
    const byProtocol = discoverResults.reduce((acc, e) => { const k = e.protocol === 'nip101e' ? 'NIP-101e' : 'Workstr'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const protocolText = Object.entries(byProtocol).map(([k, v]) => `${v} ${k}`).join(' · ');
    discoverBaseStatus = `${discoverResults.length} exercise${discoverResults.length === 1 ? '' : 's'} from ${n} relay${n === 1 ? '' : 's'} (${protocolText}).`;
    fillDiscoverFilters();
    renderDiscover();
  } catch (err) { status.textContent = err.message; }
}

// Populate the Discover filter selects from whatever the relays actually returned,
// so the choices reflect the available pool (mirrors the Library filter idiom).
function fillDiscoverFilters() {
  const cats = new Set(), muscles = new Set(), diffs = new Set();
  for (const e of discoverResults) {
    if (e.category) cats.add(e.category);
    if (e.difficulty) diffs.add(e.difficulty);
    exerciseCanonMuscles(e).forEach((m) => muscles.add(m));
  }
  fillSelect($('#discover-cat'), [...cats].sort(), 'All categories');
  fillSelect($('#discover-muscle'), [...muscles].sort(), 'All muscles');
  fillSelect($('#discover-diff'), [...diffs].sort(), 'All levels');
}

// Filter the already-fetched results client-side — instant, no relay round-trip.
function renderDiscover() {
  const grid = $('#discover-grid'); const status = $('#discover-status');
  if (!grid || !discoverResults.length) return;
  const q = $('#discover-search').value.trim().toLowerCase();
  const cat = $('#discover-cat').value, muscle = $('#discover-muscle').value, diff = $('#discover-diff').value;
  const list = discoverResults.filter((e) =>
    (!q || e.name.toLowerCase().includes(q) || (e.muscleGroup || '').toLowerCase().includes(q) || (e.tags || []).some((t) => String(t).toLowerCase().includes(q))) &&
    (!cat || e.category === cat) && (!muscle || exerciseCanonMuscles(e).has(muscle)) && (!diff || e.difficulty === diff));
  const hasFilters = Boolean(q || cat || muscle || diff);
  status.textContent = hasFilters ? `Showing ${list.length} of ${discoverBaseStatus}` : discoverBaseStatus;
  grid.innerHTML = list.length ? list.map(discoverCardHtml).join('') : '<div class="empty">No shared exercises match.</div>';
}

function discoverCardHtml(e) {
  const src = exerciseImageSrc(e.image);
  const img = `${EX_PLACEHOLDER}${src ? `<img class="card-photo" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}`;
  const author = e.pubkey ? `by ${escapeHtml(e.pubkey.slice(0, 8))}…` : '';
  const diffCls = difficultyBadgeClass(e.difficulty);
  const sourceLabel = e.protocol === 'nip101e' ? 'NIP-101e' : 'Workstr';
  return `
    <div class="ex-card" data-address="${escapeHtml(e.address)}">
      <div class="card-img">
        ${img}
        <span class="source-badge badge-nostr">${sourceLabel}</span>
        ${e.difficulty ? `<span class="diff-badge ${diffCls}">${escapeHtml(e.difficulty)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(e.name)}</div>
        <div class="card-meta">
          ${e.muscleGroup ? `<span class="muscle">${escapeHtml(e.muscleGroup)}</span>` : ''}
          ${author ? `<span class="card-tag">${author}</span>` : ''}
        </div>
        <button class="button ${e.imported ? 'ghost' : 'primary'} discover-import" data-address="${escapeHtml(e.address)}"${e.imported ? ' disabled' : ''}>${e.imported ? 'In library' : 'Import'}</button>
      </div>
    </div>`;
}

// Import a discovered exercise; reflects the result on the given button and any twin.
async function importDiscovered(data, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Importing...';
  try {
    const res = await api('discover/import', { method: 'POST', body: JSON.stringify(data) });
    data.imported = true;
    toast(res.duplicate ? 'Already in your library' : 'Imported to library');
    await loadExercises();
    document.querySelectorAll(`.discover-import[data-address="${CSS.escape(data.address)}"]`).forEach((b) => {
      b.textContent = 'In library'; b.disabled = true; b.classList.remove('primary'); b.classList.add('ghost');
    });
    return true;
  } catch (err) { btn.disabled = false; btn.textContent = label; toast(err.message, 'bad'); return false; }
}

function openDiscoverDetail(address) {
  const e = discoverResults.find((x) => x.address === address);
  if (!e) return;
  const src = exerciseImageSrc(e.image);
  const muscles = (e.muscles || []).filter(Boolean);
  const equipment = (e.equipment || []).filter(Boolean);
  const tags = (e.tags || []).filter(Boolean);
  const pills = (list) => list.map((x) => `<span class="tag-pill">${escapeHtml(x)}</span>`).join('');
  const muscleList = muscles.length ? muscles : (e.muscleGroup ? [e.muscleGroup] : []);
  const author = e.pubkey ? `${escapeHtml(e.pubkey.slice(0, 12))}…` : 'unknown';
  const sourceLabel = e.protocol === 'nip101e' ? 'NIP-101e exercise template' : 'Workstr exercise';
  openModal(`
    <div class="detail-img${src ? '' : ' placeholder'}">${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('placeholder');this.remove()">` : EX_PLACEHOLDER}</div>
    <h3 class="detail-title">${escapeHtml(e.name)}</h3>
    <div class="detail-badges">
      ${e.difficulty ? `<span class="badge diff">${escapeHtml(e.difficulty)}</span>` : ''}
      ${e.category ? `<span class="badge cat">${escapeHtml(e.category)}</span>` : ''}
      <span class="badge">${sourceLabel}</span>
    </div>
    <p class="detail-nostr">${sourceLabel} shared by <code>${author}</code>${e.relay ? ` · seen on <code>${escapeHtml(e.relay)}</code>` : ''}${e.address ? ` · <code>${escapeHtml(e.address)}</code>` : ''}</p>
    ${e.mediaUrl ? `<p class="detail-nostr">Demo video: <a href="${escapeHtml(e.mediaUrl)}" target="_blank" rel="noopener">${escapeHtml(e.mediaUrl)}</a></p>` : ''}
    ${e.description ? `<p class="detail-desc">${escapeHtml(e.description)}</p>` : ''}
    <div class="sets-info">
      <div class="sets-item"><div class="val">${e.defaultSets ?? 3}</div><div class="lbl">Sets</div></div>
      <div class="sets-item"><div class="val">${escapeHtml(e.defaultReps || '8-12')}</div><div class="lbl">Reps</div></div>
      <div class="sets-item"><div class="val">${e.defaultRest ?? 90}s</div><div class="lbl">Rest</div></div>
    </div>
    ${muscleList.length ? `<div class="subsection-head"><span>Target muscles</span></div><div class="tag-row">${pills(muscleList)}</div>` : ''}
    ${equipment.length ? `<div class="subsection-head"><span>Equipment</span></div><div class="tag-row">${pills(equipment)}</div>` : ''}
    ${tags.length ? `<div class="subsection-head"><span>Tags</span></div><div class="tag-row">${pills(tags)}</div>` : ''}
    ${(e.instructions || []).length ? `<div class="subsection-head"><span>Instructions</span></div><ol class="instruction-list">${e.instructions.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>` : ''}
    <div class="form-actions"><button class="button ${e.imported ? 'ghost' : 'primary'}" id="discover-detail-import"${e.imported ? ' disabled' : ''}>${e.imported ? 'In library' : 'Import to library'}</button></div>`);
  const btn = $('#discover-detail-import');
  btn.addEventListener('click', async () => { if (await importDiscovered(e, btn)) closeModal(); });
}

$('#discover-refresh')?.addEventListener('click', () => runDiscover());
$('#discover-search')?.addEventListener('input', renderDiscover);
['#discover-cat', '#discover-muscle', '#discover-diff'].forEach((sel) => $(sel)?.addEventListener('change', renderDiscover));
$('#discover-grid')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('.discover-import');
  if (btn) {
    if (btn.disabled) return;
    const data = discoverResults.find((x) => x.address === btn.dataset.address);
    if (data) await importDiscovered(data, btn);
    return;
  }
  const card = ev.target.closest('[data-address]');
  if (card) openDiscoverDetail(card.dataset.address);
});

// ---------- sheets ----------
async function fetchSheets() { const { sheets } = await api('sheets'); state.sheets = sheets; return sheets; }

// ---------- programs (workout templates, same structure as Liftme) ----------
const SET_ESTIMATE_SEC = 45;
function estimateProgramMin(exercises) {
  let total = 0;
  exercises.forEach((e) => { const sets = Number(e.sets) || 3; const rest = Number(e.restSec) || 90; total += sets * SET_ESTIMATE_SEC + (sets - 1) * rest; });
  return Math.round(total / 60);
}
function formatMinutes(mins) {
  if (mins <= 0) return '';
  if (mins >= 60) { const h = Math.floor(mins / 60), m = mins % 60; return `${h}h${m ? ' ' + m + 'm' : ''}`; }
  return `${mins} min`;
}
function programStatus(s) {
  if (s.nostrPublishedAt) return { cls: 'published', label: 'published' };
  if (s.nostrEventId) return { cls: 'edited', label: 'edited' };
  return { cls: 'local', label: 'local only' };
}

async function loadPrograms() {
  if (!state.exercises.length) { try { await loadExercises(); } catch {} }
  const sheets = await fetchSheets();
  const { session } = await api('sessions/active');
  state.activeSession = session;
  if (session) {
    // A quick-workout session runs on a hidden temp sheet; pull it in so resume can read its exercises.
    if (session.sheetId && !sheets.find((s) => s.id === session.sheetId)) {
      try { const s = await api(`sheets/${session.sheetId}`); if (s) state.sheets.push(s); } catch {}
    }
    sessionSetCounts = setCountsFromSession(session);
  }
  renderResumeSlot(session);
  renderPrograms(sheets);
}

function renderResumeSlot(session) {
  const slot = $('#resume-slot');
  if (!slot) return;
  if (!session) { slot.innerHTML = ''; return; }
  const loggedSets = session.sets.filter((s) => s.done).length;
  slot.innerHTML = `<div class="active-session-card">
    <div class="asc-copy">
      <span class="asc-eyebrow">Session in progress</span>
      <strong>${escapeHtml(session.sheetName || 'Freestyle')}</strong>
      <small>${loggedSets} set${loggedSets === 1 ? '' : 's'} logged · resume to keep going</small>
    </div>
    <button class="button gold" data-resume>Resume</button>
  </div>`;
}

function renderPrograms(sheets) {
  const list = $('#program-list');
  if (!sheets.length) { list.className = 'list empty'; list.textContent = 'No programs yet. Build your first routine.'; return; }
  list.className = 'program-list';
  list.innerHTML = sheets.map((s) => {
    const count = s.exercises.length;
    const time = formatMinutes(estimateProgramMin(s.exercises));
    const groups = [...new Set(s.exercises.map((e) => e.muscleGroup).filter(Boolean))];
    const meta = [`${count} exercise${count === 1 ? '' : 's'}`, s.description ? escapeHtml(s.description) : '', time ? `~${time}` : ''].filter(Boolean).join(' · ');
    const st = programStatus(s);
    return `<div class="workout-card" data-program="${s.id}">
      <div class="workout-card-header" data-toggle-program="${s.id}">
        <div class="workout-card-map" data-map="${s.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg>
        </div>
        <div class="workout-card-info">
          <div class="workout-card-name">${escapeHtml(s.name)}<span class="program-status ${st.cls}">${st.label}</span></div>
          <div class="workout-card-meta">${meta}</div>
          ${groups.length ? `<div class="workout-card-muscles">${escapeHtml(groups.join(', '))}</div>` : ''}
        </div>
        <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="workout-card-body" data-body="${s.id}"></div>
    </div>`;
  }).join('');
  sheets.forEach(paintProgramMap);
}

function paintProgramMap(sheet) {
  const host = document.querySelector(`[data-map="${sheet.id}"]`);
  if (!host) return;
  const primary = new Set(), secondary = new Set();
  sheet.exercises.forEach((ex) => {
    const p = detailCanonMuscle(ex.muscleGroup); if (p) primary.add(p);
    const full = state.exercises.find((e) => e.slug === ex.exerciseSlug);
    (full?.muscles || []).forEach((m) => { const c = detailCanonMuscle(m); if (c) secondary.add(c); });
  });
  primary.forEach((p) => secondary.delete(p));
  if (!primary.size && !secondary.size) return; // no muscle data — keep the dumbbell icon
  buildBodyMapInto(host, primary, secondary);
  host.classList.add('has-map');
}

function renderProgramBody(sheetId) {
  const sheet = state.sheets.find((s) => s.id === sheetId);
  const body = document.querySelector(`[data-body="${sheetId}"]`);
  if (!sheet || !body) return;
  const exHtml = sheet.exercises.length ? sheet.exercises.map((e, i) => {
    const src = exerciseImageSrc(e.imageUrl || state.exercises.find((x) => x.slug === e.exerciseSlug)?.imageUrl);
    const img = src
      ? `<img class="wk-ex-img" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wk-ex-img placeholder'}))">`
      : `<div class="wk-ex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
    return `<div class="wk-ex-item" data-exitem="${sheetId}-${i}">
      <div class="wk-ex-header" data-toggle-exitem="${sheetId}-${i}">
        ${img}
        <div class="wk-ex-info">
          <div class="wk-ex-name">${escapeHtml(e.exerciseName)}</div>
          <div class="wk-ex-short">${Number(e.sets) || 3} × ${escapeHtml(e.reps || '8-12')}${e.weight != null ? ' @ ' + wFmt(e.weight) : ''}</div>
        </div>
        ${e.muscleGroup ? `<span class="wk-ex-muscle-pill">${escapeHtml(e.muscleGroup)}</span>` : ''}
        <svg class="wk-ex-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wk-ex-detail">
        <div class="wk-ex-detail-grid">
          <div class="wk-ex-detail-cell"><div class="val">${Number(e.sets) || 3}</div><div class="lbl">Sets</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${escapeHtml(e.reps || '8-12')}</div><div class="lbl">Reps</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${e.weight != null ? wFmt(e.weight) : '—'}</div><div class="lbl">Weight</div></div>
          <div class="wk-ex-detail-cell"><div class="val">${Number(e.restSec) || 90}s</div><div class="lbl">Rest</div></div>
        </div>
        ${e.notes ? `<div class="wk-ex-detail-note">${escapeHtml(e.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="empty" style="padding:10px 0">No exercises yet. Edit this program to add some.</p>';
  body.innerHTML = `
    <div class="wk-ex-list">${exHtml}</div>
    <div class="workout-card-actions">
      <button class="button gold small" data-start-program="${sheetId}">Start workout</button>
      <button class="button ghost small" data-edit-program="${sheetId}">Edit</button>
      <button class="button ghost small" data-publish-program="${sheetId}">Publish</button>
      <button class="button danger small" data-del-program="${sheetId}">Delete</button>
    </div>`;
}

function sheetBuilderHtml(sheet = { name: '', description: '', exercises: [] }) {
  return `
    <h3>${sheet.id ? 'Edit program' : 'New program'}</h3>
    <div class="form-grid">
      <label class="span-2">Name<input id="sheet-name" value="${escapeHtml(sheet.name)}" placeholder="Push Day" /></label>
      <label class="span-2">Description<input id="sheet-desc" value="${escapeHtml(sheet.description)}" placeholder="optional" /></label>
    </div>
    <div class="subsection-head"><span>Exercises</span></div>
    <div class="builder-search-wrap">
      <input id="builder-search" class="builder-search" placeholder="Search exercises to add..." autocomplete="off" />
      <div id="builder-results" class="builder-results" style="display:none"></div>
    </div>
    <div id="builder-rows" class="builder-rows"></div>
    <div class="form-actions"><button class="button primary" id="sheet-save">${sheet.id ? 'Save program' : 'Create program'}</button></div>`;
}

let builderRows = [];
function renderBuilderRows() {
  const host = $('#builder-rows');
  if (!builderRows.length) { host.innerHTML = '<div class="empty" style="padding:8px 0">No exercises yet. Search above to add.</div>'; return; }
  host.innerHTML = builderRows.map((r, i) => {
    const src = exerciseImageSrc(r.imageUrl || state.exercises.find((e) => e.slug === r.exerciseSlug)?.imageUrl);
    const img = src
      ? `<img class="wex-img" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'wex-img placeholder'}))">`
      : `<div class="wex-img placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
    return `<div class="wex-row" data-i="${i}">
      <div class="wex-move-btns">
        <button class="wex-move-btn" type="button" data-move="${i}" data-dir="-1" title="Move up">↑</button>
        <button class="wex-move-btn" type="button" data-move="${i}" data-dir="1" title="Move down">↓</button>
      </div>
      ${img}
      <div class="wex-info">
        <div class="wex-name">${escapeHtml(r.exerciseName)}${r.muscleGroup ? `<span class="wex-muscle">${escapeHtml(r.muscleGroup)}</span>` : ''}</div>
        <div class="wex-params">
          <div class="wex-param-group"><div class="wex-param-label">Sets</div><input class="wex-param-input" type="number" min="1" max="20" data-f="sets" value="${r.sets}"></div>
          <div class="wex-param-group"><div class="wex-param-label">Reps</div><input class="wex-param-input reps" data-f="reps" value="${escapeHtml(r.reps)}"></div>
          <div class="wex-param-group"><div class="wex-param-label">${unitLabel()}</div><input class="wex-param-input" type="number" min="0" step="0.5" data-f="weight" placeholder="—" value="${r.weight != null ? wDisplay(r.weight) : ''}"></div>
          <div class="wex-param-group"><div class="wex-param-label">Rest</div><input class="wex-param-input" type="number" min="0" step="5" data-f="restSec" value="${r.restSec}"></div>
        </div>
      </div>
      <button class="wex-remove" type="button" data-rm="${i}" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function openSheetBuilder(sheet = null) {
  builderRows = sheet ? sheet.exercises.map((e) => ({ exerciseSlug: e.exerciseSlug, exerciseName: e.exerciseName, muscleGroup: e.muscleGroup, imageUrl: e.imageUrl, sets: e.sets, reps: e.reps, restSec: e.restSec, weight: e.weight ?? null, notes: e.notes || '' })) : [];
  openModal(sheetBuilderHtml(sheet || { name: '', description: '', exercises: [] }));
  renderBuilderRows();
  const search = $('#builder-search');
  const results = $('#builder-results');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.style.display = 'none'; results.innerHTML = ''; return; }
    const matches = state.exercises
      .filter((e) => e.name.toLowerCase().includes(q) || (e.muscleGroup || '').toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { results.innerHTML = '<div class="ex-search-empty">No exercises match.</div>'; results.style.display = 'block'; return; }
    results.style.display = 'block';
    results.innerHTML = matches.map((e) => {
      const added = builderRows.some((r) => r.exerciseSlug === e.slug);
      return `<div class="ex-search-result-item${added ? ' added' : ''}" data-add-slug="${escapeHtml(e.slug)}"><span>${escapeHtml(e.name)}</span><span class="muscle">${added ? 'added' : escapeHtml(e.muscleGroup || '')}</span></div>`;
    }).join('');
  });
  results.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-slug]');
    if (!item) return;
    const ex = state.exercises.find((x) => x.slug === item.dataset.addSlug);
    if (ex && !builderRows.some((r) => r.exerciseSlug === ex.slug)) {
      builderRows.push({ exerciseSlug: ex.slug, exerciseName: ex.name, muscleGroup: ex.muscleGroup, imageUrl: ex.imageUrl, sets: ex.defaultSets, reps: ex.defaultReps, restSec: ex.defaultRest, weight: null, notes: '' });
      renderBuilderRows();
    }
    search.value = ''; results.style.display = 'none'; results.innerHTML = '';
    search.focus();
  });
  $('#builder-rows').addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    const i = Number(row.dataset.i), f = e.target.dataset.f;
    if (f === 'sets' || f === 'restSec') builderRows[i][f] = Number(e.target.value) || 0;
    else if (f === 'weight') builderRows[i].weight = wStore(e.target.value);
    else builderRows[i][f] = e.target.value;
  });
  $('#builder-rows').addEventListener('click', (e) => {
    const rm = e.target.dataset.rm, mv = e.target.dataset.move;
    if (rm != null) { builderRows.splice(Number(rm), 1); renderBuilderRows(); }
    else if (mv != null) {
      const i = Number(mv), dir = Number(e.target.dataset.dir), j = i + dir;
      if (j >= 0 && j < builderRows.length) { [builderRows[i], builderRows[j]] = [builderRows[j], builderRows[i]]; renderBuilderRows(); }
    }
  });
  $('#sheet-save').addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      const payload = { name: $('#sheet-name').value.trim(), description: $('#sheet-desc').value.trim(), exercises: builderRows.map((r, i) => ({ ...r, position: i })) };
      if (!payload.name) throw new Error('name is required');
      if (sheet) await api(`sheets/${sheet.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('sheets', { method: 'POST', body: JSON.stringify(payload) });
      closeModal(); toast('Program saved'); renderPrograms(await fetchSheets());
    });
  });
}

// ---------- training session ----------
function getSessionExercises(session) {
  const sheet = state.sheets.find((s) => s.id === session.sheetId);
  if (sheet && sheet.exercises.length) return sheet.exercises;
  return uniqueLoggedExercises(session);
}

function uniqueLoggedExercises(session) {
  const slugs = [...new Set(session.sets.map((s) => s.exerciseSlug))];
  return slugs.map((slug) => ({ exerciseSlug: slug, exerciseName: state.exercises.find((e) => e.slug === slug)?.name || slug, sets: null, reps: '', restSec: 90 }));
}

function setCountsFromSession(session) {
  const counts = {};
  getSessionExercises(session).forEach((ex) => {
    const logged = session.sets.filter((s) => s.exerciseSlug === ex.exerciseSlug).length;
    counts[ex.exerciseSlug] = Math.max(Number(ex.sets) || 1, logged || 1);
  });
  return counts;
}

async function startTrainingSession(sheetId) {
  const session = await api('sessions', { method: 'POST', body: JSON.stringify({ sheetId: Number(sheetId) || null }) });
  state.activeSession = session;
  sessionExerciseIndex = 0;
  sessionSetCounts = setCountsFromSession(session);
  refreshSessionCount();
  await openSessionOverlay(session);
}

// ---- Keep the screen awake (Wake Lock API + muted-video fallback for plain HTTP/LAN) ----
async function requestSessionWakeLock() {
  if (sessionWakeLock || sessionNoSleepVideo) return;
  if ('wakeLock' in navigator) {
    try {
      sessionWakeLock = await navigator.wakeLock.request('screen');
      sessionWakeLock.addEventListener('release', () => { sessionWakeLock = null; });
      return;
    } catch {}
  }
  try {
    const vid = document.createElement('video');
    vid.setAttribute('playsinline', '');
    vid.muted = true;
    vid.loop = true;
    vid.style.cssText = 'position:fixed;top:-2px;left:-2px;width:1px;height:1px;opacity:0;pointer-events:none';
    vid.innerHTML = '<source src="./nosleep.webm" type="video/webm"><source src="./nosleep.mp4" type="video/mp4">';
    document.body.appendChild(vid);
    await vid.play();
    sessionNoSleepVideo = vid;
  } catch { if (sessionNoSleepVideo) { sessionNoSleepVideo.remove(); sessionNoSleepVideo = null; } }
}

function releaseSessionWakeLock() {
  if (sessionWakeLock) { sessionWakeLock.release(); sessionWakeLock = null; }
  if (sessionNoSleepVideo) { sessionNoSleepVideo.pause(); sessionNoSleepVideo.remove(); sessionNoSleepVideo = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.activeSession && $('#session-overlay')?.classList.contains('open')) requestSessionWakeLock();
});

async function openSessionOverlay(session) {
  const overlay = $('#session-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  requestSessionWakeLock();
  clearInterval(sessionElapsedTimer);
  updateSessionElapsed(session);
  sessionElapsedTimer = setInterval(() => updateSessionElapsed(state.activeSession), 1000);
  if (!Object.keys(sessionSetCounts).length) sessionSetCounts = setCountsFromSession(session);
  sessionPRs = [];
  loadPRbaseline();
  await renderSessionExercise(session);
}

// All-time best estimated 1RM per exercise — the bar a mid-session PR must beat.
function loadPRbaseline() {
  sessionPRbaseline = {};
  api('stats').then((stats) => { (stats.prs || []).forEach((p) => { sessionPRbaseline[p.slug] = p.e1rm; }); }).catch(() => {});
}

function updateSessionElapsed(session) {
  const el = $('#session-elapsed');
  if (!el || !session?.startedAt) return;
  const started = new Date(String(session.startedAt).replace(' ', 'T') + (String(session.startedAt).endsWith('Z') ? '' : 'Z')).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  el.textContent = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function loggedSetCount(slug) {
  return state.activeSession ? state.activeSession.sets.filter((s) => s.exerciseSlug === slug && s.done).length : 0;
}

function updateSessionProgress() {
  const fill = $('#session-progress-fill');
  if (!fill || !state.activeSession) return;
  const exercises = getSessionExercises(state.activeSession);
  let total = 0, done = 0;
  exercises.forEach((ex) => {
    const target = sessionSetCounts[ex.exerciseSlug] || Number(ex.sets) || 1;
    total += target;
    done += Math.min(loggedSetCount(ex.exerciseSlug), target);
  });
  fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

function renderSessionNav(exercises) {
  $('#session-ex-nav').innerHTML = exercises.map((ex, i) => {
    const target = Number(ex.sets) || sessionSetCounts[ex.exerciseSlug] || 1;
    const cls = i === sessionExerciseIndex ? 'current' : loggedSetCount(ex.exerciseSlug) >= target ? 'done' : '';
    return `<button class="session-ex-dot ${cls}" data-jump-ex="${i}">${i + 1}</button>`;
  }).join('');
}

function exerciseImageUrl(ex) {
  const url = ex.imageUrl || state.exercises.find((e) => e.slug === ex.exerciseSlug)?.imageUrl || '';
  return exerciseImageSrc(url);
}

function previousSetKey(sessionId, slug) { return `${sessionId}:${slug}`; }

// Awaited so a slow lookup never re-renders over what the user just typed.
async function getPreviousSets(sessionId, slug) {
  const key = previousSetKey(sessionId, slug);
  if (sessionPreviousSets.has(key)) return sessionPreviousSets.get(key) || [];
  try {
    const res = await api(`exercises/${encodeURIComponent(slug)}/last-sets?beforeSessionId=${sessionId}`);
    sessionPreviousSets.set(key, res.sets || []);
  } catch { sessionPreviousSets.set(key, []); }
  return sessionPreviousSets.get(key) || [];
}

function formatSetHint(set) {
  if (!set) return '';
  const reps = set.reps ?? '?';
  const weight = set.weight == null ? '' : ` @ ${wFmt(set.weight)}`;
  return `${reps}${weight}`;
}

function suggestedSetHint(prev, targetReps) {
  if (!prev) return '';
  return `suggested: ${escapeHtml(targetReps || prev.reps || 'reps')} reps${prev.weight == null ? '' : ` @ ${wFmt(prev.weight)}`}`;
}

function exerciseInstructions(slug) {
  return state.exercises.find((e) => e.slug === slug)?.instructions || [];
}

async function renderSessionExercise(session) {
  const exercises = getSessionExercises(session);
  if (!exercises.length) {
    $('#session-title').textContent = session.sheetName || 'Freestyle';
    $('#session-meta').textContent = 'No exercises yet';
    $('#session-ex-nav').innerHTML = '';
    $('#session-progress-fill').style.width = '0%';
    $('#session-body').innerHTML = '<div class="empty">This freestyle session has no exercises yet. Add sets from a sheet session for now.</div>';
    $('#session-footer').innerHTML = '<button class="session-finish-btn" id="finish-session">Finish session</button>';
    return;
  }
  if (sessionExerciseIndex >= exercises.length) sessionExerciseIndex = exercises.length - 1;
  const ex = exercises[sessionExerciseIndex];
  const slug = ex.exerciseSlug;
  const name = ex.exerciseName || state.exercises.find((e) => e.slug === slug)?.name || slug;
  const restSec = Number(ex.restSec) || 90;
  const targetSets = Number(ex.sets) || sessionSetCounts[slug] || 1;
  const targetReps = ex.reps || '';
  const logged = session.sets.filter((s) => s.exerciseSlug === slug);
  const imageUrl = exerciseImageUrl(ex);
  const previousSets = await getPreviousSets(session.id, slug);
  if (state.activeSession?.id !== session.id || getSessionExercises(state.activeSession)[sessionExerciseIndex]?.exerciseSlug !== slug) return;
  sessionSetCounts[slug] = Math.max(sessionSetCounts[slug] || targetSets, logged.length || targetSets);
  const rows = Array.from({ length: sessionSetCounts[slug] }, (_, i) => {
    const done = logged.find((s) => Number(s.setNumber) === i + 1);
    const prev = previousSets[i];
    const locked = !done && i > 0 && !logged.find((s) => Number(s.setNumber) === i);
    const prevHint = prev ? `<div class="session-set-hint prev">prev: ${escapeHtml(formatSetHint(prev))}</div>` : '';
    const suggestHint = prev ? `<div class="session-set-hint suggest">${suggestedSetHint(prev, targetReps)}</div>` : '';
    return `<div class="session-set-block ${locked ? 'locked' : ''}" data-set-block="${i}">
      <div class="session-set-row">
        <div class="session-set-num ${done ? 'done' : ''}" data-set-num="${i}">${i + 1}</div>
        <input class="session-set-input" data-session-reps="${i}" type="number" inputmode="numeric" placeholder="${escapeHtml(targetReps || prev?.reps || 'reps')}" value="${done?.reps ?? ''}" ${done || locked ? 'disabled' : ''}>
        <input class="session-set-input" data-session-weight="${i}" type="number" inputmode="decimal" step="0.5" placeholder="${prev?.weight != null ? wDisplay(prev.weight) : (ex.weight != null ? wDisplay(ex.weight) : unitLabel())}" value="${done?.weight != null ? wDisplay(done.weight) : ''}" ${done || locked ? 'disabled' : ''}>
        ${done ? `<button class="session-log-btn done" data-set-log-btn="${i}" disabled>Done</button>` : `<button class="session-log-btn" data-session-log="${escapeHtml(slug)}" data-set-index="${i}" data-set-log-btn="${i}" data-rest="${restSec}" ${locked ? 'disabled' : ''}>Log</button>`}
      </div>
      ${prevHint}${suggestHint}
    </div>`;
  }).join('');
  const instructions = exerciseInstructions(slug);
  const instructionsHtml = instructions.length ? `
    <div class="session-instructions" id="session-instructions">
      <div class="session-instructions-toggle" data-toggle-instructions>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>How to perform</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="session-instructions-body">
        ${instructions.map((step, i) => `<div class="session-instructions-step"><b>${i + 1}</b>${escapeHtml(step)}</div>`).join('')}
      </div>
    </div>` : '';
  $('#session-title').textContent = session.sheetName || 'Freestyle';
  $('#session-meta').textContent = `Exercise ${sessionExerciseIndex + 1} of ${exercises.length}`;
  renderSessionNav(exercises);
  $('#session-body').innerHTML = `
    ${imageUrl ? `<img class="session-ex-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="eager" onerror="this.classList.add('placeholder');this.removeAttribute('src')">` : '<div class="session-ex-image placeholder">No exercise image</div>'}
    <div class="session-ex-name">${escapeHtml(name)}</div>
    <div class="session-ex-target"><b>${targetSets}</b> sets <span class="dot"></span> <b>${escapeHtml(targetReps || 'free')}</b> reps <span class="dot"></span> <b>${restSec}s</b> rest</div>
    ${ex.notes ? `<div class="session-note">${escapeHtml(ex.notes)}</div>` : ''}
    <div class="session-sets">${rows}</div>
    <button class="session-add-set" data-add-session-set="${escapeHtml(slug)}">+ Add set</button>
    ${instructionsHtml}`;
  const isLast = sessionExerciseIndex >= exercises.length - 1;
  $('#session-footer').innerHTML = `
    ${isLast ? '<button class="session-finish-btn" id="finish-session">Finish session</button>' : `<button class="session-next-btn" data-jump-ex="${sessionExerciseIndex + 1}">Next</button>`}`;
  updateSessionProgress();
}

async function logSessionSet(slug, setIndex, restSec) {
  const repsEl = $(`[data-session-reps="${setIndex}"]`);
  const weightEl = $(`[data-session-weight="${setIndex}"]`);
  const logBtn = $(`[data-set-log-btn="${setIndex}"]`);
  const reps = repsEl?.value ?? '';
  const weight = weightEl?.value ?? '';
  if (reps === '' && weight === '') {
    repsEl?.focus();
    repsEl?.classList.add('shake');
    setTimeout(() => repsEl?.classList.remove('shake'), 420);
    return;
  }
  const repsNum = reps === '' ? null : Number(reps);
  const weightNum = weight === '' ? null : wStore(weight); // input is in the display unit; store kg
  if (logBtn) { logBtn.disabled = true; logBtn.textContent = '···'; }
  try {
    const session = await api(`sessions/${state.activeSession.id}/sets`, { method: 'POST', body: JSON.stringify({ exerciseSlug: slug, setNumber: setIndex + 1, reps: repsNum, weight: weightNum }) });
    state.activeSession = session;
  } catch (error) {
    toast(error.message || String(error), 'bad');
    if (logBtn) { logBtn.disabled = false; logBtn.textContent = 'Log'; }
    return;
  }

  // In-place: mark this set done, lock its inputs, no full re-render (keeps focus + scroll).
  if (repsEl) repsEl.disabled = true;
  if (weightEl) weightEl.disabled = true;
  $(`[data-set-num="${setIndex}"]`)?.classList.add('done');
  $(`[data-set-block="${setIndex}"]`)?.classList.add('just-logged');
  if (logBtn) { logBtn.textContent = 'Done'; logBtn.classList.add('done'); logBtn.disabled = true; logBtn.removeAttribute('data-session-log'); }

  // Unlock the next set and carry the weight/reps forward into it.
  const nextBlock = $(`[data-set-block="${setIndex + 1}"]`);
  if (nextBlock) {
    nextBlock.classList.remove('locked');
    nextBlock.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
    const nReps = $(`[data-session-reps="${setIndex + 1}"]`);
    const nWeight = $(`[data-session-weight="${setIndex + 1}"]`);
    if (nReps && !nReps.value && repsNum != null) nReps.value = repsNum;
    if (nWeight && !nWeight.value && weight !== '') nWeight.value = weight; // carry the typed display value
  }

  renderSessionNav(getSessionExercises(state.activeSession));
  updateSessionProgress();
  detectPR(slug, repsNum, weightNum);

  const target = sessionSetCounts[slug] || 1;
  const allDone = loggedSetCount(slug) >= target;
  startSessionRest(restSec, allDone);
}

// Epley estimated 1RM; celebrate only when it beats a prior recorded best.
function detectPR(slug, reps, weight) {
  if (!reps || !weight) return;
  const e1rm = Math.round(weight * (1 + reps / 30) * 10) / 10;
  const prev = sessionPRbaseline[slug] || 0;
  if (prev > 0 && e1rm > prev) {
    sessionPRbaseline[slug] = e1rm;
    const name = state.exercises.find((e) => e.slug === slug)?.name || slug;
    if (!sessionPRs.find((p) => p.slug === slug)) sessionPRs.push({ slug, name, e1rm });
    else sessionPRs.find((p) => p.slug === slug).e1rm = e1rm;
    showPRToast(name, e1rm);
  } else if (prev === 0) {
    sessionPRbaseline[slug] = e1rm; // first record sets the bar; no toast
  }
}

let prToastTimer = null;
function showPRToast(name, e1rm) {
  const el = $('#pr-toast');
  if (!el) return;
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    <div class="pr-toast-main"><strong>New PR</strong><small>${escapeHtml(name)} · ~${wDisplay(e1rm)}${unitLabel()} est. 1RM</small></div>`;
  el.classList.add('show');
  clearTimeout(prToastTimer);
  prToastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function startSessionRest(sec, autoAdvance) {
  const overlay = $('#session-rest-overlay');
  overlay.classList.add('show');
  sessionRestTotal = Number(sec) || 90;
  sessionRestRemaining = sessionRestTotal;
  const nextUp = $('#rest-nextup');
  if (nextUp) {
    const exercises = getSessionExercises(state.activeSession);
    const next = autoAdvance ? exercises[sessionExerciseIndex + 1] : null;
    nextUp.innerHTML = next ? `Next up: <b>${escapeHtml(next.exerciseName || next.exerciseSlug)}</b>` : '';
  }
  updateSessionRestDisplay();
  clearInterval(sessionRestTimer);
  sessionRestTimer = setInterval(() => {
    sessionRestRemaining -= 1;
    updateSessionRestDisplay();
    if (sessionRestRemaining <= 0) {
      skipSessionRest();
      if (autoAdvance) {
        const exercises = getSessionExercises(state.activeSession);
        if (sessionExerciseIndex < exercises.length - 1) { sessionExerciseIndex += 1; renderSessionExercise(state.activeSession); }
      }
    }
  }, 1000);
}

function updateSessionRestDisplay() {
  $('#session-rest-val').textContent = sessionRestRemaining;
  const fg = $('#rest-ring-fg');
  if (fg) {
    const circumference = 339.3;
    const offset = sessionRestTotal > 0 ? circumference * (1 - sessionRestRemaining / sessionRestTotal) : 0;
    fg.style.strokeDashoffset = Math.max(0, Math.min(circumference, offset));
    fg.style.stroke = sessionRestRemaining <= 5 ? 'var(--danger-red)' : 'var(--sovereign-purple)';
  }
}

function adjustRest(delta) {
  sessionRestRemaining = Math.max(5, sessionRestRemaining + delta);
  if (sessionRestTotal < sessionRestRemaining) sessionRestTotal = sessionRestRemaining;
  updateSessionRestDisplay();
}

function skipSessionRest() {
  clearInterval(sessionRestTimer);
  $('#session-rest-overlay').classList.remove('show');
}

async function finishActiveSession() {
  const prs = sessionPRs.slice();
  const s = await api(`sessions/${state.activeSession.id}/finish`, { method: 'POST', body: JSON.stringify({}) });
  closeSessionOverlay();
  const tempSheetId = state.activeSession.sheetId;
  state.activeSession = null;
  refreshSessionCount();
  cleanupTempSheet(tempSheetId);
  renderFinished(s, prs);
}

async function cancelActiveSession() {
  if (!state.activeSession) return closeSessionOverlay();
  if (!confirm('End and discard this session? Logged sets will be deleted.')) return;
  const tempSheetId = state.activeSession.sheetId;
  await api(`sessions/${state.activeSession.id}`, { method: 'DELETE' });
  state.activeSession = null;
  closeSessionOverlay();
  toast('Session discarded');
  refreshSessionCount();
  await cleanupTempSheet(tempSheetId);
  loadPrograms();
}

function closeSessionOverlay(clear = true) {
  clearInterval(sessionRestTimer);
  clearInterval(sessionElapsedTimer);
  releaseSessionWakeLock();
  $('#session-rest-overlay')?.classList.remove('show');
  $('#session-overlay')?.classList.remove('open');
  $('#pr-toast')?.classList.remove('show');
  if (clear) {
    sessionSetCounts = {};
    sessionExerciseIndex = 0;
    sessionPreviousSets.clear();
    sessionPRs = [];
  }
}

function sessionDurationLabel(session) {
  if (!session.startedAt || !session.finishedAt) return '—';
  const toMs = (v) => new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z')).getTime();
  const sec = Math.max(0, Math.round((toMs(session.finishedAt) - toMs(session.startedAt)) / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function renderFinished(session, prs = []) {
  const doneSets = session.sets.filter((s) => s.done);
  const volume = Math.round(doneSets.reduce((a, s) => a + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0));
  const exerciseCount = new Set(doneSets.map((s) => s.exerciseSlug)).size;
  const stats = [
    { val: sessionDurationLabel(session), label: 'Duration' },
    { val: doneSets.length, label: 'Sets' },
    { val: volume > 0 ? `${Math.round(wDisplay(volume))} ${unitLabel()}` : '—', label: 'Volume' },
    { val: exerciseCount, label: 'Exercises' }
  ];
  const prHtml = prs.length ? `
    <div class="subsection-head"><span>Personal records</span><small>this session</small></div>
    <div class="summary-pr-chips">${prs.map((p) => `<span class="summary-pr-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${escapeHtml(p.name)} ~${Math.round(wDisplay(p.e1rm))}${unitLabel()} 1RM</span>`).join('')}</div>` : '';
  openModal(`
    <div class="summary-hero">
      <div class="sh-medal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12"/></svg></div>
      <div class="sh-copy"><strong>${escapeHtml(session.sheetName || 'Freestyle')}</strong><small>nicely done — here's the recap</small></div>
    </div>
    <div class="summary-stats">${stats.map((s) => `<div class="summary-stat"><div class="ss-val">${escapeHtml(String(s.val))}</div><div class="ss-label">${s.label}</div></div>`).join('')}</div>
    ${prHtml}
    <div class="subsection-head"><span>Vs last time</span><small>working-set volume per exercise</small></div>
    <div class="summary-compare" id="summary-compare"><div class="empty">Comparing…</div></div>
    <div class="form-actions">
      <button class="button gold" id="share-summary" data-session="${session.id}">Share summary via Idenstr</button>
      <button class="button ghost" id="finish-done">Done</button>
    </div>
    <div id="share-result" class="terminal-mini" style="display:none"></div>`);
  $('#finish-done').addEventListener('click', () => { closeModal(); goTo('workouts', 'programs'); });
  $('#share-summary').addEventListener('click', async (e) => {
    await withButtonState(e.currentTarget, async () => {
      const res = await api(`sessions/${session.id}/share`, { method: 'POST' });
      const box = $('#share-result'); box.style.display = 'block';
      const relays = (res.relayResults || []).map((r) => `${r.accepted ? 'OK ' : 'x  '} ${r.relay}`).join('\n');
      box.textContent = `Published kind:1 summary via Idenstr.\n\n${res.text}\n\n${relays || 'No relay results returned.'}`;
      toast('Summary published');
    });
  });
  renderSessionComparison(session, doneSets);
}

async function renderSessionComparison(session, doneSets) {
  const host = $('#summary-compare');
  if (!host) return;
  const slugs = [...new Set(doneSets.map((s) => s.exerciseSlug))];
  if (!slugs.length) { host.innerHTML = '<div class="empty">No sets logged.</div>'; return; }
  const volBySlug = {};
  doneSets.forEach((s) => { volBySlug[s.exerciseSlug] = (volBySlug[s.exerciseSlug] || 0) + (Number(s.reps) || 0) * (Number(s.weight) || 0); });
  const prevData = await Promise.all(slugs.map((slug) =>
    api(`exercises/${encodeURIComponent(slug)}/last-sets?beforeSessionId=${session.id}`).then((r) => r.sets || []).catch(() => [])
  ));
  const rows = slugs.map((slug, i) => {
    const name = state.exercises.find((e) => e.slug === slug)?.name || slug;
    const cur = Math.round(volBySlug[slug] || 0);
    const prev = Math.round((prevData[i] || []).reduce((a, s) => a + (Number(s.reps) || 0) * (Number(s.weight) || 0), 0));
    const curD = Math.round(wDisplay(cur) || 0), prevD = Math.round(wDisplay(prev) || 0);
    let delta, cls;
    if (!prev) { delta = `${curD} ${unitLabel()}`; cls = 'flat'; }
    else if (cur > prev) { delta = `▲ +${curD - prevD} ${unitLabel()}`; cls = 'up'; }
    else if (cur < prev) { delta = `▼ −${prevD - curD} ${unitLabel()}`; cls = 'down'; }
    else { delta = `= ${curD} ${unitLabel()}`; cls = 'flat'; }
    return `<div class="compare-row"><div class="cr-name">${escapeHtml(name)}</div><div class="cr-delta ${cls}">${delta}</div></div>`;
  }).join('');
  host.innerHTML = rows;
}

// ---------- history (completed sessions) ----------
const parseDbDate = (iso) => new Date(String(iso || '').replace(' ', 'T') + (String(iso || '').endsWith('Z') ? '' : 'Z'));

function formatSessionDate(iso) {
  const d = parseDbDate(iso);
  return Number.isNaN(d.getTime()) ? (iso || '') : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function sessionDuration(s) {
  if (!s.startedAt || !s.finishedAt) return '';
  const min = Math.round((parseDbDate(s.finishedAt) - parseDbDate(s.startedAt)) / 60000);
  if (!Number.isFinite(min) || min <= 0) return '';
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

function setSessionCount(n) {
  const el = $('#live-status');
  if (el) el.textContent = `${n} session${n === 1 ? '' : 's'}`;
}

async function refreshSessionCount() {
  try { const { sessions } = await api('sessions'); setSessionCount(sessions.length); } catch {}
}

async function loadHistory() {
  if (!state.exercises.length) { try { await loadExercises(); } catch {} }
  const { sessions } = await api('sessions');
  setSessionCount(sessions.length);
  renderHistory(sessions);
}

function renderHistory(sessions) {
  const list = $('#history-list');
  if (!sessions.length) { list.className = 'list empty'; list.textContent = 'No completed sessions yet. Finish a workout to see it here.'; return; }
  list.className = 'program-list';
  list.innerHTML = sessions.map((s) => {
    const meta = [
      formatSessionDate(s.finishedAt || s.startedAt),
      sessionDuration(s),
      `${s.setCount} set${s.setCount === 1 ? '' : 's'}`,
      s.volume > 0 ? `${Math.round(wDisplay(s.volume))} ${unitLabel()} volume` : ''
    ].filter(Boolean).join(' · ');
    return `<div class="workout-card" data-session="${s.id}">
      <div class="workout-card-header" data-toggle-session="${s.id}">
        <div class="workout-card-map">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </div>
        <div class="workout-card-info">
          <div class="workout-card-name">${escapeHtml(s.sheetName || 'Freestyle')}${s.shared ? '<span class="program-status published">shared</span>' : ''}</div>
          <div class="workout-card-meta">${meta}</div>
        </div>
        <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="workout-card-body" data-session-body="${s.id}"></div>
    </div>`;
  }).join('');
}

async function renderSessionDetail(sessionId) {
  const body = document.querySelector(`[data-session-body="${sessionId}"]`);
  if (!body) return;
  body.innerHTML = '<p class="empty" style="padding:10px 0">Loading…</p>';
  const session = await api(`sessions/${sessionId}`);
  const byEx = new Map();
  (session.sets || []).filter((s) => s.done).forEach((set) => {
    if (!byEx.has(set.exerciseSlug)) byEx.set(set.exerciseSlug, []);
    byEx.get(set.exerciseSlug).push(set);
  });
  const exName = (slug) => state.exercises.find((e) => e.slug === slug)?.name || slug;
  const rows = [...byEx.entries()].map(([slug, sets]) => {
    const pills = sets.sort((a, b) => a.setNumber - b.setNumber).map((s) =>
      `<span class="set-pill">${s.reps ?? '?'}${s.weight != null ? ` × ${wFmt(s.weight)}` : ''}</span>`
    ).join('');
    return `<div class="session-detail-ex">
      <div class="session-detail-ex-name">${escapeHtml(exName(slug))}</div>
      <div class="session-detail-sets">${pills}</div>
    </div>`;
  }).join('');
  body.innerHTML = `<div class="session-detail">
    ${rows || '<p class="empty" style="padding:6px 0 12px">No sets were logged in this session.</p>'}
    ${session.notes ? `<div class="wk-ex-detail-note">${escapeHtml(session.notes)}</div>` : ''}
    <div class="workout-card-actions">
      <button class="button danger small" data-del-session="${sessionId}">Delete session</button>
    </div>
  </div>`;
}

// ---------- recovery ----------
const RECOVERY_COLORS = { ready: '#00d084', partial: '#f7931a', recovering: '#ff3864', untrained: '#3a3052' };
let recoveryByMuscle = {};

function recoveryNote(m) {
  return m.status === 'untrained' ? 'not trained recently' : m.percent >= 100 ? 'fully recovered' : `${m.hoursRemaining}h to full`;
}

async function loadRecovery() {
  const data = await api('recovery');
  $('#recovery-overall').textContent = `${data.overallReadiness}%`;
  $('#recovery-ready').textContent = `${data.readyCount}/${data.totalCount} ready`;
  recoveryByMuscle = {};
  data.muscleGroups.forEach((m) => { recoveryByMuscle[m.name] = m; });

  // Colour the anatomical map (inline style overrides the SVG base fill).
  $$('#recovery-body [data-muscle]').forEach((el) => {
    const m = recoveryByMuscle[el.dataset.muscle];
    el.style.fill = RECOVERY_COLORS[m ? m.status : 'untrained'];
  });

  // Compact list, most-fatigued first.
  const order = { recovering: 0, partial: 1, ready: 2, untrained: 3 };
  const sorted = [...data.muscleGroups].sort((a, b) => (order[a.status] - order[b.status]) || a.percent - b.percent);
  const host = $('#recovery-list');
  host.className = 'recovery';
  host.innerHTML = sorted.map((m) => `
    <div class="recovery-row ${m.status}">
      <div class="rname">${escapeHtml(m.name)}</div>
      <div class="rtrack"><div class="rfill" style="width:${m.percent}%"></div></div>
      <div class="rmeta"><strong>${m.percent}%</strong><small>${recoveryNote(m)}</small></div>
    </div>`).join('');
}

function recoveryHighlight(name) {
  $$('#recovery-body [data-muscle]').forEach((el) => el.classList.toggle('hl', name != null && el.dataset.muscle === name));
}

// ---------- quick workout (generated from recovered muscles) ----------
let qwDuration = 45;
let qwExercises = [];
let qwPool = {};

async function generateQuickWorkout(btn) {
  await withButtonState(btn, async () => {
    const data = await api('recovery/quick-workout', { method: 'POST', body: JSON.stringify({ durationMinutes: qwDuration, minRecoveryPercent: 80 }) });
    if (!data.exercises?.length) {
      $('#qw-result').hidden = true;
      toast('No recovered muscle groups with exercises yet — train or add exercises first.', 'bad');
      return;
    }
    qwExercises = data.exercises;
    qwPool = data.pool || {};
    renderQwList();
    $('#qw-meta').textContent = `${data.exercises.length} exercises · ~${data.estimatedDurationMin} min · ${(data.targetMuscleGroups || []).join(', ')}`;
    $('#qw-result').hidden = false;
  });
}

function renderQwList() {
  $('#qw-list').innerHTML = qwExercises.map((ex, i) => {
    const hasSwap = (qwPool[ex.muscleGroup] || []).length > 0;
    return `<div class="qw-item">
      <div class="qw-item-info">
        <div class="qw-item-name">${escapeHtml(ex.name)}</div>
        <div class="qw-item-meta">${escapeHtml(ex.muscleGroup)} · ${ex.sets} × ${escapeHtml(ex.reps)}</div>
      </div>
      <div class="qw-item-actions">
        ${hasSwap ? `<button class="button ghost small" data-qw-swap="${i}">Swap</button>` : ''}
        <button class="button ghost small" data-qw-remove="${i}" title="Remove">✕</button>
      </div>
    </div>`;
  }).join('');
}

function swapQwExercise(i) {
  const ex = qwExercises[i];
  const pool = qwPool[ex.muscleGroup] || [];
  if (!pool.length) return;
  const replacement = pool.shift();
  pool.push(ex); // cycle the swapped-out exercise back in
  qwPool[ex.muscleGroup] = pool;
  qwExercises[i] = replacement;
  renderQwList();
}

function removeQwExercise(i) {
  qwExercises.splice(i, 1);
  if (!qwExercises.length) { $('#qw-result').hidden = true; return; }
  renderQwList();
}

async function startQuickWorkout(btn) {
  if (!qwExercises.length) return;
  await withButtonState(btn, async () => {
    const groups = [...new Set(qwExercises.map((e) => e.muscleGroup).filter(Boolean))];
    const name = 'Quick — ' + (groups.length ? groups.join(', ') : 'Mixed');
    // A temporary sheet: it runs the session but is hidden from Programs and removed afterwards.
    const sheet = await api('sheets', { method: 'POST', body: JSON.stringify({
      name, isTemporary: true,
      exercises: qwExercises.map((e, i) => ({ exerciseSlug: e.slug, sets: e.sets, reps: e.reps, restSec: e.restSec, position: i }))
    }) });
    state.sheets.push(sheet); // so getSessionExercises can resolve this hidden sheet
    const session = await api('sessions', { method: 'POST', body: JSON.stringify({ sheetId: sheet.id }) });
    state.activeSession = session;
    sessionExerciseIndex = 0;
    sessionSetCounts = setCountsFromSession(session);
    refreshSessionCount();
    $('#qw-result').hidden = true;
    await openSessionOverlay(session);
  });
}

async function cleanupTempSheet(sheetId) {
  if (!sheetId) return;
  const sheet = state.sheets.find((s) => s.id === sheetId);
  if (!sheet || !sheet.isTemporary) return;
  try { await api(`sheets/${sheetId}`, { method: 'DELETE' }); } catch {}
  state.sheets = state.sheets.filter((s) => s.id !== sheetId);
}

// ---------- progress ----------
async function loadProgress() {
  const [stats, { entries }] = await Promise.all([api('stats'), api('body')]);
  $('#prog-total').textContent = Math.round(wDisplay(stats.totalVolume) || 0);
  const max = Math.max(1, ...stats.weekly.map((w) => w.volume));
  $('#prog-bars').innerHTML = stats.weekly.length ? stats.weekly.map((w) => `<div class="bar"><div class="fill" style="height:${Math.round((w.volume / max) * 100)}%"></div><span class="blabel">${escapeHtml(w.week.split('-')[1])}</span></div>`).join('') : '<div class="empty">No volume logged yet.</div>';
  const distMax = Math.max(1, ...stats.muscle.map((m) => m.sets));
  const dist = $('#prog-dist');
  if (stats.muscle.length) { dist.className = 'dist'; dist.innerHTML = stats.muscle.map((m) => `<div class="dist-row"><small>${escapeHtml(m.muscle)}</small><div class="track"><div class="fill" style="width:${Math.round((m.sets / distMax) * 100)}%"></div></div><small>${m.sets}</small></div>`).join(''); }
  else { dist.className = 'dist empty'; dist.textContent = 'No logged sets yet.'; }
  const prs = $('#prog-prs');
  if (stats.prs.length) { prs.className = 'list'; prs.innerHTML = stats.prs.map((p) => `<div class="row"><div><strong>${escapeHtml(p.name)}</strong><small>top ${wDisplay(p.topWeight)} ${unitLabel()}</small></div><span class="badge muscle">${wDisplay(p.e1rm)} ${unitLabel()} 1RM</span></div>`).join(''); }
  else { prs.className = 'list empty'; prs.textContent = 'No records yet.'; }
  renderBody(entries);
}

function renderBody(entries) {
  const list = $('#body-list');
  if (!entries.length) { list.className = 'list empty'; list.textContent = 'No entries yet.'; return; }
  list.className = 'list';
  list.innerHTML = entries.map((b) => `<div class="row"><div><strong>${wDisplay(b.weightKg)} ${unitLabel()}</strong><small>${escapeHtml(b.date)}${b.notes ? ' · ' + escapeHtml(b.notes) : ''}</small></div><button class="button danger small" data-del-body="${b.id}">×</button></div>`).join('');
}

// ---------- connect ----------
async function loadConnect() {
  const cfg = await api('connect');
  $('#connect-form').idenstrUrl.value = cfg.idenstrUrl;
  $('#connect-form').idenstrToken.placeholder = cfg.tokenConfigured ? 'token configured — leave blank to keep' : 'idstr_...';
  $('#connect-form').localRelayUrl.value = cfg.localRelayUrl || '';
  const settings = await api('settings');
  state.unit = settings.weightUnit;
  $('#unit-select').value = state.unit;
  applyUnitLabels();
  await testConnection();
  await loadVault();
}

async function loadVault() {
  const host = $('#vault-sheets');
  try {
    const res = await api('vault/sheets');
    if (!res.configured) { host.className = 'list empty'; host.textContent = 'No local relay configured — set one above to read the vault.'; return; }
    if (res.error) { host.className = 'list empty'; host.textContent = `Vault unreachable: ${res.error}`; return; }
    if (!res.sheets.length) { host.className = 'list empty'; host.textContent = 'Vault reachable — no sheets stored yet. Publish a sheet to store it here.'; return; }
    host.className = 'list';
    host.innerHTML = res.sheets.map((s) => `<div class="row"><div><strong>${escapeHtml(s.title)}</strong><small>${s.exercises} exercises · ${escapeHtml(s.address)}</small></div><span class="badge muscle">stored</span></div>`).join('');
  } catch (error) { host.className = 'list empty'; host.textContent = error.message; }
}

async function testConnection() {
  const pill = $('#connect-pill'), box = $('#connect-status');
  pill.className = 'status-pill'; pill.textContent = 'checking';
  try {
    const s = await api('connect/status');
    pill.className = `status-pill ${s.ok ? 'ok' : 'bad'}`;
    pill.textContent = s.ok ? 'connected' : 'not ready';
    box.textContent = [
      `idenstr: ${s.idenstrUrl}`,
      `reachable: ${s.health ? 'yes' : 'no'}`,
      `token: ${s.tokenConfigured ? 'configured' : 'missing'}`,
      `granted scopes: ${(s.grantedScopes || []).join(', ') || '(none)'}`,
      `required: ${s.requiredScopes.join(', ')}`,
      s.missingScopes && s.missingScopes.length ? `MISSING: ${s.missingScopes.join(', ')}` : 'all required scopes granted',
      s.error ? `error: ${s.error}` : ''
    ].filter(Boolean).join('\n');
  } catch (error) { pill.className = 'status-pill bad'; pill.textContent = 'error'; box.textContent = error.message; }
}

function applyUnitLabels() {
  $('#body-unit').textContent = state.unit;
  $$('.body-unit-lbl').forEach((el) => { el.textContent = state.unit; });
}

// ---------- event wiring ----------
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$$('.nav-item').forEach((n) => n.addEventListener('click', () => switchTab(n.dataset.tab)));
$$('.sub-tab').forEach((t) => t.addEventListener('click', () => switchSubTab(t.dataset.parent, t.dataset.subtab)));

// Recovery body-map hover: highlight muscle + tooltip
const recoveryBody = $('#recovery-body');
if (recoveryBody) {
  const tip = $('#recovery-tip');
  recoveryBody.addEventListener('mousemove', (e) => {
    const poly = e.target.closest('[data-muscle]');
    if (!poly) { tip.hidden = true; recoveryHighlight(null); return; }
    const name = poly.dataset.muscle, m = recoveryByMuscle[name];
    recoveryHighlight(name);
    const rect = recoveryBody.parentElement.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${e.clientX - rect.left}px`;
    tip.style.top = `${e.clientY - rect.top}px`;
    tip.innerHTML = m
      ? `<strong>${escapeHtml(name)}</strong><small>${m.percent}% · ${m.status}${m.status !== 'untrained' && m.percent < 100 ? ` · ${m.hoursRemaining}h left` : ''}</small>`
      : `<strong>${escapeHtml(name)}</strong><small>no data</small>`;
  });
  recoveryBody.addEventListener('mouseleave', () => { tip.hidden = true; recoveryHighlight(null); });
}

$('#new-exercise').addEventListener('click', () => openExerciseModal());
['ex-search', 'ex-cat', 'ex-muscle', 'ex-diff'].forEach((id) => $('#' + id).addEventListener('input', renderExercises));
$('#ex-grid').addEventListener('click', async (e) => {
  const fav = e.target.dataset.fav;
  if (fav) { e.stopPropagation(); const ex = state.exercises.find((x) => x.slug === fav); await api(`exercises/${encodeURIComponent(fav)}/favourite`, { method: 'POST', body: JSON.stringify({ favourite: !ex.favourite }) }); await loadExercises(); return; }
  const card = e.target.closest('[data-slug]'); if (card) openExerciseDetail(card.dataset.slug);
});

$('#new-program').addEventListener('click', async () => { if (!state.exercises.length) await loadExercises(); openSheetBuilder(); });
$('#program-list').addEventListener('click', async (e) => {
  const head = e.target.closest('[data-toggle-program]');
  if (head) {
    const id = Number(head.dataset.toggleProgram);
    const card = head.closest('.workout-card');
    const wasOpen = card.classList.contains('expanded');
    document.querySelectorAll('.workout-card.expanded').forEach((c) => c.classList.remove('expanded'));
    if (!wasOpen) { renderProgramBody(id); card.classList.add('expanded'); }
    return;
  }
  const exHead = e.target.closest('[data-toggle-exitem]');
  if (exHead) { exHead.closest('.wk-ex-item').classList.toggle('open'); return; }
  const start = e.target.closest('[data-start-program]');
  if (start) { await withButtonState(start, async () => startTrainingSession(Number(start.dataset.startProgram))); return; }
  const edit = e.target.closest('[data-edit-program]');
  if (edit) { if (!state.exercises.length) await loadExercises(); openSheetBuilder(await api(`sheets/${edit.dataset.editProgram}`)); return; }
  const pub = e.target.closest('[data-publish-program]');
  if (pub) { await withButtonState(pub, async () => { await api(`sheets/${pub.dataset.publishProgram}/publish`, { method: 'POST' }); toast('Program signed & stored in vault'); renderPrograms(await fetchSheets()); }); return; }
  const del = e.target.closest('[data-del-program]');
  if (del) { if (confirm('Delete this program?')) { await api(`sheets/${del.dataset.delProgram}`, { method: 'DELETE' }); toast('Program deleted'); renderPrograms(await fetchSheets()); } return; }
});
$('#resume-slot').addEventListener('click', (e) => { if (e.target.closest('[data-resume]') && state.activeSession) openSessionOverlay(state.activeSession); });

$('#qw-duration').addEventListener('click', (e) => {
  const b = e.target.closest('[data-qw-dur]'); if (!b) return;
  qwDuration = Number(b.dataset.qwDur);
  $$('#qw-duration .qw-dur-btn').forEach((x) => x.classList.toggle('active', x === b));
});
$('#qw-generate').addEventListener('click', (e) => generateQuickWorkout(e.currentTarget));
$('#qw-start').addEventListener('click', (e) => startQuickWorkout(e.currentTarget));
$('#qw-list').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-qw-swap]'); if (sw) { swapQwExercise(Number(sw.dataset.qwSwap)); return; }
  const rm = e.target.closest('[data-qw-remove]'); if (rm) { removeQwExercise(Number(rm.dataset.qwRemove)); return; }
});

$('#history-list').addEventListener('click', async (e) => {
  const head = e.target.closest('[data-toggle-session]');
  if (head) {
    const id = Number(head.dataset.toggleSession);
    const card = head.closest('.workout-card');
    const wasOpen = card.classList.contains('expanded');
    $$('#history-list .workout-card.expanded').forEach((c) => c.classList.remove('expanded'));
    if (!wasOpen) { card.classList.add('expanded'); renderSessionDetail(id); }
    return;
  }
  const del = e.target.closest('[data-del-session]');
  if (del) {
    if (!confirm('Delete this session? All logged sets will be permanently removed from your history and stats.')) return;
    await withButtonState(del, async () => { await api(`sessions/${del.dataset.delSession}`, { method: 'DELETE' }); });
    toast('Session deleted');
    loadHistory();
    return;
  }
});

$('#session-overlay').addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle-instructions]');
  if (toggle) { $('#session-instructions')?.classList.toggle('open'); return; }
  const jumpBtn = e.target.closest('[data-jump-ex]');
  if (jumpBtn) { sessionExerciseIndex = Number(jumpBtn.dataset.jumpEx); renderSessionExercise(state.activeSession); return; }
  const addBtn = e.target.closest('[data-add-session-set]');
  if (addBtn) { const slug = addBtn.dataset.addSessionSet; sessionSetCounts[slug] = (sessionSetCounts[slug] || 0) + 1; renderSessionExercise(state.activeSession); return; }
  const logBtn = e.target.closest('[data-session-log]');
  if (logBtn) { logSessionSet(logBtn.dataset.sessionLog, Number(logBtn.dataset.setIndex), Number(logBtn.dataset.rest)); return; }
  if (e.target.id === 'finish-session') await withButtonState(e.target, finishActiveSession);
  if (e.target.id === 'cancel-session') cancelActiveSession();
});

$('#session-rest-overlay').addEventListener('click', (e) => {
  if (e.target.dataset.restAdjust) adjustRest(Number(e.target.dataset.restAdjust));
  if (e.target.id === 'skip-session-rest') skipSessionRest();
});


$('#body-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  await withButtonState(form.querySelector('button[type=submit]'), async () => {
    await api('body', { method: 'POST', body: JSON.stringify({ date: form.date.value || undefined, weightKg: wStore(form.weightKg.value), notes: '' }) });
    form.reset(); toast('Weight logged'); loadProgress();
  });
});
$('#body-list').addEventListener('click', async (e) => { const del = e.target.dataset.delBody; if (del) { await api(`body/${del}`, { method: 'DELETE' }); loadProgress(); } });

$('#connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  await withButtonState(form.querySelector('button[type=submit]'), async () => {
    const body = { idenstrUrl: form.idenstrUrl.value, localRelayUrl: form.localRelayUrl.value };
    if (form.idenstrToken.value.trim()) body.idenstrToken = form.idenstrToken.value.trim();
    await api('connect', { method: 'PUT', body: JSON.stringify(body) });
    form.idenstrToken.value = ''; toast('Connection saved'); await testConnection(); await loadVault();
  });
});
$('#test-connect').addEventListener('click', (e) => withButtonState(e.currentTarget, testConnection));
$('#unit-select').addEventListener('change', async (e) => { await api('settings', { method: 'PUT', body: JSON.stringify({ weightUnit: e.target.value }) }); state.unit = e.target.value; applyUnitLabels(); toast('Weight unit updated'); });

// ---------- boot ----------
async function boot() {
  // Load the weight-unit preference before the first render so every view (programs,
  // history, sessions) shows values in the chosen unit instead of defaulting to kg.
  try { const s = await api('settings'); state.unit = s.weightUnit || 'kg'; } catch {}
  const sel = $('#unit-select'); if (sel) sel.value = state.unit;
  applyUnitLabels();
  api('dashboard').then((d) => { setSessionCount(d.sessions); }).catch(() => { $('#live-status').textContent = 'api error'; });
  switchTab('exercises');
}
boot();
