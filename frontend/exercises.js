// ── Exercises ─────────────────────────────────────────────────────────────────
async function loadExercises(status) {
  const res = await fetch('/api/exercises?status=' + status + '&per_page=200');
  const data = await res.json();
  exercisesData = data.exercises || [];
  renderGrid(status);
}

function renderGrid(status) {
  let gridId, emptyId;
  if (status === 'staged') { gridId = 'staging-grid'; emptyId = 'staging-empty'; }
  else if (status === 'trashed') { gridId = 'trash-grid'; emptyId = 'trash-empty'; }
  else { gridId = 'exercise-grid'; emptyId = 'exercises-empty'; }

  const grid = document.getElementById(gridId);
  const empty = document.getElementById(emptyId);
  const noMatch = document.getElementById('exercises-no-match');

  let list = exercisesData;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(e =>
      (e.name||'').toLowerCase().includes(q) ||
      (e.category||'').toLowerCase().includes(q) ||
      (e.muscle_group||'').toLowerCase().includes(q)
    );
  }

  if (status === 'active') {
    if (filterCategory) list = list.filter(e => e.category === filterCategory);
    if (filterMuscle) list = list.filter(e => e.muscle_group === filterMuscle);
    if (filterDifficulty) list = list.filter(e => e.difficulty === filterDifficulty);
  }

  const isFiltered = searchQuery || filterCategory || filterMuscle || filterDifficulty;
  const countEl = document.getElementById('exercise-count');

  if (!list.length) {
    grid.innerHTML = '';
    if (exercisesData.length === 0) {
      if (empty) empty.style.display = '';
      if (noMatch) noMatch.style.display = 'none';
    } else {
      if (empty) empty.style.display = 'none';
      if (noMatch) noMatch.style.display = '';
    }
    if (countEl) countEl.textContent = '';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (noMatch) noMatch.style.display = 'none';
  if (countEl) countEl.textContent = isFiltered ? `Showing ${list.length} of ${exercisesData.length}` : '';

  grid.innerHTML = list.map(e => buildCard(e, status)).join('');

  // Staging bulk actions
  if (status === 'staged') {
    const approveBtn = document.getElementById('approve-all-btn');
    const discardBtn = document.getElementById('discard-all-btn');
    const info = document.getElementById('staging-info');
    if (approveBtn) approveBtn.style.display = list.length ? '' : 'none';
    if (discardBtn) discardBtn.style.display = list.length ? '' : 'none';
    if (info) info.textContent = `${list.length} exercise${list.length !== 1 ? 's' : ''} waiting for review`;
  }
}

function buildCard(e, status) {
  const img = e.image_url
    ? `<img src="${e.image_url.startsWith('http') ? e.image_url : '/' + e.image_url}" alt="" loading="lazy">`
    : `<div class="card-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;

  const badgeClass = {ai:'badge-ai',seed:'badge-seed',camera:'badge-camera'}[e.source_type] || 'badge-manual';
  const badge = `<div class="source-badge ${badgeClass}">${esc(e.source_type||'manual')}</div>`;

  const diffClass = {beginner:'diff-beginner',intermediate:'diff-intermediate',advanced:'diff-advanced'}[e.difficulty] || '';
  const diffBadge = e.difficulty ? `<div class="diff-badge ${diffClass}">${esc(e.difficulty)}</div>` : '';

  const selCheck = `<div class="sel-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`;
  return `<div class="exercise-card${_selectMode?' selectable':''}${_selectedSlugs.has(e.slug)?' selected':''}" data-slug="${e.slug}" onclick="_cardClick('${e.slug}')">
    <div class="card-img" style="position:relative">${img}${badge}${diffBadge}${selCheck}</div>
    <div class="card-body">
      <div class="card-name">${esc(e.name)}</div>
      <div class="card-meta">
        ${e.muscle_group ? `<span>${esc(e.muscle_group)}</span>` : ''}
        ${e.category ? `<span class="card-tag">${esc(e.category)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function onSearch() {
  searchQuery = document.getElementById('search-input').value.trim();
  const statusMap = {exercises:'active',staging:'staged',trash:'trashed'};
  renderGrid(statusMap[currentTab] || 'active');
}

function applyFilters() {
  filterCategory = document.getElementById('filter-category').value;
  filterMuscle = document.getElementById('filter-muscle').value;
  filterDifficulty = document.getElementById('filter-difficulty').value;
  const isFiltered = filterCategory || filterMuscle || filterDifficulty;
  document.getElementById('filter-clear').style.display = isFiltered ? '' : 'none';
  renderGrid('active');
}

function clearFilters() {
  filterCategory = filterMuscle = filterDifficulty = '';
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-muscle').value = '';
  document.getElementById('filter-difficulty').value = '';
  document.getElementById('filter-clear').style.display = 'none';
  renderGrid('active');
}

// ── Drawer ────────────────────────────────────────────────────────────────────
async function openDrawer(slug) {
  const res = await fetch('/api/exercises/' + slug);
  const ex = await res.json();
  const full = ex.full || {};
  const logData = await fetch('/api/log/' + slug).then(r => r.json());

  _drawerData = { slug, ex, full };

  const rawImg = ex.image_url ? (ex.image_url.startsWith('http') ? ex.image_url : '/' + ex.image_url) : null;
  const imgUrl = rawImg && !rawImg.startsWith('http') ? rawImg + '?t=' + Date.now() : rawImg;
  const imgHtml = `<div style="position:relative">` + (imgUrl
    ? `<img class="drawer-img" src="${imgUrl}" alt="">`
    : `<div class="drawer-img"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`)
    + `<div class="d-img-shimmer" id="d-img-shimmer"></div>`
    + `<button class="d-img-regen" id="d-img-regen-btn" style="display:none" onclick="regenImage()" title="Regenerate AI photo"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>`
    + `</div>`;

  const muscles = (ex.muscles||[]).map(m=>`<span class="tag-pill">${esc(m)}</span>`).join('');
  const equip = (ex.equipment_list||[]).map(e=>`<span class="tag-pill">${esc(e)}</span>`).join('');
  const tags = (ex.tags||[]).filter(t=>t).map(t=>`<span class="tag-pill">${esc(t)}</span>`).join('');

  const setsInfo = (full.default_sets || full.default_reps || full.default_rest_sec) ? `
    <div class="sets-info">
      ${full.default_sets ? `<div class="sets-item"><div class="val">${full.default_sets}</div><div class="lbl">Sets</div></div>` : ''}
      ${full.default_reps ? `<div class="sets-item"><div class="val">${esc(full.default_reps)}</div><div class="lbl">Reps</div></div>` : ''}
      ${full.default_rest_sec ? `<div class="sets-item"><div class="val">${full.default_rest_sec}s</div><div class="lbl">Rest</div></div>` : ''}
    </div>` : '';

  const instructions = (full.instructions || []);
  const steps = instructions.map(s => {
    const text = typeof s === 'string' ? s : (s.text || s.description || '');
    return `<li>${esc(text)}</li>`;
  }).join('');

  const logHtml = logData.length ? `
    <div class="drawer-section">Recent Sessions</div>
    ${logData.slice(0,5).map(l => {
      const sets = (typeof l.sets === 'string' ? JSON.parse(l.sets||'[]') : (l.sets||[]));
      const pills = sets.map(s => `<span class="set-pill">${s.reps||'-'}${s.weight ? ' @ ' + _wFmt(s.weight) : ''}</span>`).join('');
      const d = new Date(l.logged_at);
      return `<div class="log-entry"><div class="log-entry-date">${d.toLocaleDateString()}</div><div class="log-entry-sets">${pills||'<span style="font-size:11px;color:var(--text-muted)">No set data</span>'}</div></div>`;
    }).join('')}` : '';

  let actions = '';
  if (ex.status === 'active') {
    actions = `
      <button class="btn-outline" onclick="editDrawer()">Edit</button>
      <button class="btn-danger" onclick="trashExercise('${slug}')">Delete</button>`;
  } else if (ex.status === 'staged') {
    actions = `
      <button class="btn-sage" onclick="approveExercise('${slug}')">Approve</button>
      <button class="btn-outline" onclick="editDrawer()">Edit</button>
      <button class="btn-danger" onclick="trashExercise('${slug}')">Discard</button>`;
  } else if (ex.status === 'trashed') {
    actions = `
      <button class="btn-sage" onclick="restoreExercise('${slug}')">Restore</button>
      <button class="btn-danger" onclick="permDelete('${slug}')">Delete Forever</button>`;
  }

  document.getElementById('drawer-content').innerHTML = `
    ${imgHtml}
    <div class="drawer-body">
      <div class="drawer-title">${esc(ex.name)}</div>
      ${ex.description ? `<p style="font-size:13px;color:var(--text-mid);margin-bottom:12px;line-height:1.5">${esc(ex.description)}</p>` : ''}
      ${setsInfo}
      ${muscles ? `<div class="drawer-section">Target Muscles</div><div class="tag-row">${muscles}</div><div id="drawer-muscle-map"></div>` : ''}
      ${equip ? `<div class="drawer-section">Equipment</div><div class="tag-row">${equip}</div>` : ''}
      ${tags ? `<div class="drawer-section">Tags</div><div class="tag-row">${tags}</div>` : ''}
      ${steps ? `<div class="drawer-section">Instructions</div><ol class="instruction-list">${steps}</ol>` : ''}
      <div id="drawer-progress"></div>
      ${logHtml}
      <div class="drawer-actions">${actions}</div>
    </div>`;

  document.getElementById('drawer-overlay').classList.add('open');

  // Render muscle body map if we have muscle data
  if (ex.muscle_group || (ex.muscles && ex.muscles.length)) {
    _renderDrawerMuscleMap(ex.muscle_group, ex.muscles);
  }

  if (ex.status === 'active') {
    loadExerciseProgress(slug, document.getElementById('drawer-progress'));
  }
}

function closeDrawer() { document.getElementById('drawer-overlay').classList.remove('open'); }
function closeDrawerIfOverlay(e) { if (e.target === document.getElementById('drawer-overlay')) closeDrawer(); }

function editDrawer() {
  if (!_drawerData) return;
  const { slug, ex, full } = _drawerData;

  // Show regen button
  const regenBtn = document.getElementById('d-img-regen-btn');
  if (regenBtn) regenBtn.style.display = '';

  const muscles = (full.muscles || ex.muscles || []).join('\n');
  const equip = (full.equipment || ex.equipment_list || []).join('\n');
  const tags = (full.tags || ex.tags || []).filter(t=>t).join(', ');
  const instructions = (full.instructions || []).map(s => typeof s === 'string' ? s : (s.text||'')).join('\n');

  document.getElementById('drawer-content').querySelector('.drawer-body').innerHTML = `
    <div class="edit-field">
      <label>Name</label>
      <input id="ef-name" value="${esc(full.name || ex.name || '')}">
    </div>
    <div class="edit-field">
      <label>Description</label>
      <textarea id="ef-desc" rows="3">${esc(full.description || ex.description || '')}</textarea>
    </div>
    <div class="edit-grid">
      <div class="edit-field">
        <label>Category</label>
        <select id="ef-category">
          <option value="">--</option>
          ${['strength','cardio','flexibility','balance','plyometrics'].map(c=>
            `<option value="${c}"${(full.category||ex.category)===c?' selected':''}>${c}</option>`
          ).join('')}
        </select>
      </div>
      <div class="edit-field">
        <label>Difficulty</label>
        <select id="ef-difficulty">
          <option value="">--</option>
          ${['beginner','intermediate','advanced'].map(d=>
            `<option value="${d}"${(full.difficulty||ex.difficulty)===d?' selected':''}>${d}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div class="edit-field">
      <label>Primary Muscle Group</label>
      <input id="ef-muscle-group" value="${esc(full.muscle_group || ex.muscle_group || '')}">
    </div>
    <div class="edit-field">
      <label>Muscles -- one per line</label>
      <textarea id="ef-muscles" rows="3">${esc(muscles)}</textarea>
    </div>
    <div class="edit-field">
      <label>Equipment -- one per line</label>
      <textarea id="ef-equipment" rows="3">${esc(equip)}</textarea>
    </div>
    <div class="edit-field">
      <label>Tags -- comma separated</label>
      <input id="ef-tags" value="${esc(tags)}">
    </div>
    <div class="edit-grid">
      <div class="edit-field">
        <label>Default Sets</label>
        <input id="ef-sets" type="number" min="1" value="${full.default_sets||3}">
      </div>
      <div class="edit-field">
        <label>Default Reps</label>
        <input id="ef-reps" value="${esc(full.default_reps||'8-12')}">
      </div>
    </div>
    <div class="edit-field">
      <label>Rest Between Sets (seconds)</label>
      <input id="ef-rest" type="number" min="0" value="${full.default_rest_sec||90}">
    </div>
    <div class="edit-field">
      <label>Instructions -- one step per line</label>
      <textarea id="ef-instructions" rows="8">${esc(instructions)}</textarea>
    </div>
    <div class="drawer-actions">
      <button class="btn-primary" onclick="saveDrawer()" style="height:32px;font-size:12px">Save</button>
      <button class="btn-outline" onclick="openDrawer('${slug}')">Cancel</button>
    </div>`;
}

async function saveDrawer() {
  if (!_drawerData) return;
  const slug = _drawerData.slug;
  const name = document.getElementById('ef-name').value.trim();
  if (!name) { alert('Name is required'); return; }

  const data = {
    name,
    description: document.getElementById('ef-desc').value.trim(),
    category: document.getElementById('ef-category').value,
    difficulty: document.getElementById('ef-difficulty').value,
    muscle_group: document.getElementById('ef-muscle-group').value.trim(),
    muscles: document.getElementById('ef-muscles').value.split('\n').map(l=>l.trim()).filter(Boolean),
    equipment: document.getElementById('ef-equipment').value.split('\n').map(l=>l.trim()).filter(Boolean),
    tags: document.getElementById('ef-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    default_sets: parseInt(document.getElementById('ef-sets').value) || 3,
    default_reps: document.getElementById('ef-reps').value.trim() || '8-12',
    default_rest_sec: parseInt(document.getElementById('ef-rest').value) || 90,
    instructions: document.getElementById('ef-instructions').value.split('\n').map(l=>l.trim()).filter(Boolean),
  };

  try {
    const res = await fetch('/api/exercises/' + slug, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Save failed');
    openDrawer(slug);
    loadExercises();
  } catch(e) { alert(e.message); }
}

async function regenImage() {
  if (!_drawerData) return;
  const slug = _drawerData.slug;
  const btn = document.getElementById('d-img-regen-btn');
  const shimmer = document.getElementById('d-img-shimmer');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  if (shimmer) shimmer.classList.add('visible');
  try {
    const res = await fetch('/api/exercises/' + slug + '/regenerate-image', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Image generation failed');
    if (data.image) {
      const src = '/' + data.image + '?t=' + Date.now();
      const img = document.getElementById('drawer-content').querySelector('.drawer-img');
      if (img && img.tagName === 'IMG') { img.src = src; }
      else if (img) { img.innerHTML = `<img class="drawer-img" src="${src}" alt="" style="width:100%;height:100%;object-fit:cover">`; }
      // Update card in grid
      const card = document.querySelector(`.exercise-card[data-slug="${slug}"] img`);
      if (card) card.src = src;
      _drawerData.ex.image_url = data.image;
    }
  } catch(e) { alert(e.message || 'Image generation failed'); }
  finally {
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    if (shimmer) shimmer.classList.remove('visible');
  }
}

// Map raw muscle names to the canonical data-muscle values used in the SVG body map
const _MUSCLE_ALIASES = {
  'chest':'Chest','pectorals':'Chest','pecs':'Chest','upper chest':'Chest',
  'back':'Back','lats':'Back','latissimus dorsi':'Back','upper back':'Back',
  'mid back':'Back','middle back':'Back','lower back':'Back','lumbar':'Back',
  'erector spinae':'Back','traps':'Back','trapezius':'Back',
  'shoulders':'Shoulders','deltoids':'Shoulders','deltoid':'Shoulders',
  'anterior deltoid':'Shoulders','posterior deltoid':'Shoulders',
  'lateral deltoid':'Shoulders','supraspinatus':'Shoulders',
  'biceps':'Biceps','bicep':'Biceps','brachialis':'Biceps',
  'brachioradialis':'Biceps','forearms':'Biceps','forearm':'Biceps','arms':'Biceps',
  'triceps':'Triceps','tricep':'Triceps',
  'core':'Core','abs':'Core','abdominals':'Core','obliques':'Core','full body':'Core',
  'quadriceps':'Quadriceps','quads':'Quadriceps','legs':'Quadriceps',
  'hamstrings':'Hamstrings','hamstring':'Hamstrings',
  'glutes':'Glutes','glute':'Glutes','gluteus maximus':'Glutes',
  'calves':'Calves','calf':'Calves',
};
function _canonMuscle(name) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return _MUSCLE_ALIASES[n] || null;
}

function _renderDrawerMuscleMap(primaryMuscleGroup, secondaryMuscles) {
  const container = document.getElementById('drawer-muscle-map');
  if (!container) return;

  const src = document.getElementById('body-map-svg');
  if (!src) { container.innerHTML = ''; return; }

  const svg = src.cloneNode(true);
  svg.removeAttribute('id');

  // Resolve canonical names
  const primary = _canonMuscle(primaryMuscleGroup) || primaryMuscleGroup;
  const secondaries = new Set(
    (secondaryMuscles || []).map(m => _canonMuscle(m)).filter(c => c && c !== primary)
  );

  // Color the polygons
  svg.querySelectorAll('[data-muscle]').forEach(el => {
    const m = el.dataset.muscle;
    if (m === primary) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.9');
    } else if (secondaries.has(m)) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.35');
    } else {
      el.setAttribute('fill', '#ede7dc');
      el.removeAttribute('opacity');
    }
  });

  // Remove FRONT/BACK text labels for the mini version
  svg.querySelectorAll('text').forEach(t => t.remove());

  container.innerHTML = '';
  container.className = 'drawer-muscle-map';
  container.appendChild(svg);
}

// ── Select mode ───────────────────────────────────────────────────────────────

let _selectMode = false;
let _selectedSlugs = new Set();
const _selectTabs = ['exercises'];

function _syncSelToggleBtns(active) {
  const el = document.getElementById('topbar-select-btn');
  if (el) el.classList.toggle('active', active);
}

function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedSlugs.clear();
  _syncSelToggleBtns(_selectMode);
  _updateBulkBar();
  const statusMap = {exercises:'active',staging:'staged',trash:'trashed'};
  const s = statusMap[currentTab];
  if (s) renderGrid(s);
}

function exitSelectMode() {
  _selectMode = false;
  _selectedSlugs.clear();
  _syncSelToggleBtns(false);
  _updateBulkBar();
  const statusMap = {exercises:'active',staging:'staged',trash:'trashed'};
  const s = statusMap[currentTab];
  if (s) renderGrid(s);
}

function deselectAll() {
  _selectedSlugs.clear();
  document.querySelectorAll('.exercise-card.selected').forEach(c => c.classList.remove('selected'));
  _updateBulkBar();
}

function _cardClick(slug) {
  if (!_selectMode) { openDrawer(slug); return; }
  if (_selectedSlugs.has(slug)) _selectedSlugs.delete(slug);
  else _selectedSlugs.add(slug);
  const card = document.querySelector(`.exercise-card[data-slug="${slug}"]`);
  if (card) card.classList.toggle('selected', _selectedSlugs.has(slug));
  _updateBulkBar();
}

function _updateBulkBar() {
  const bar        = document.getElementById('bulk-bar');
  const selInfo    = document.getElementById('topbar-sel-info');
  const selCount   = document.getElementById('topbar-sel-count');
  const searchEl   = document.getElementById('search-wrap');
  const favBtn     = document.getElementById('bulk-fav-btn');
  const approveBtn = document.getElementById('bulk-approve-btn');
  const trashBtn   = document.getElementById('bulk-trash-btn');
  const restoreBtn = document.getElementById('bulk-restore-btn');
  const delBtn     = document.getElementById('bulk-del-btn');
  if (!bar) return;
  const n = _selectedSlugs.size;
  const searchTabs = ['exercises', 'staging', 'trash'];
  const searchable = searchTabs.includes(currentTab);

  // Topbar: swap search with selection info
  if (selInfo) selInfo.style.display = _selectMode ? 'flex' : 'none';
  if (searchEl) searchEl.style.display = (_selectMode || !searchable) ? 'none' : 'flex';
  if (selCount) selCount.textContent = n === 0
    ? 'Select exercises below'
    : `${n} exercise${n !== 1 ? 's' : ''} selected`;

  // Bulk bar slides up only when something is selected
  bar.classList.toggle('open', _selectMode && n > 0);

  // Show/hide buttons based on current tab
  const onStage = currentTab === 'staging';
  const onTrash = currentTab === 'trash';
  if (favBtn)     favBtn.style.display     = (!onStage && !onTrash) ? '' : 'none';
  if (approveBtn) approveBtn.style.display = onStage ? '' : 'none';
  if (trashBtn)   trashBtn.style.display   = (!onTrash) ? '' : 'none';
  if (restoreBtn) restoreBtn.style.display = onTrash ? '' : 'none';
  if (delBtn)     delBtn.style.display     = onTrash ? '' : 'none';
}

async function bulkAction(action) {
  const slugs = [..._selectedSlugs];
  if (!slugs.length) return;
  if (['trash', 'perm-delete'].includes(action)) {
    const label = action === 'perm-delete' ? 'permanently delete' : 'trash';
    if (!confirm(`${label} ${slugs.length} exercise${slugs.length!==1?'s':''}?`)) return;
  }
  const handlers = {
    'trash': sl => fetch('/api/exercises/'+sl, {method:'DELETE'}),
    'approve': sl => fetch('/api/exercises/approve/'+sl, {method:'POST'}),
    'restore': sl => fetch('/api/exercises/restore/'+sl, {method:'POST'}),
    'perm-delete': sl => fetch('/api/exercises/permanent/'+sl, {method:'DELETE'}),
  };
  const fn = handlers[action];
  if (!fn) return;
  await Promise.all(slugs.map(fn));
  refreshCounts();
  exitSelectMode();
  switchTab(currentTab);
}

// ── Exercise actions ──────────────────────────────────────────────────────────
async function trashExercise(slug) {
  await fetch('/api/exercises/'+slug, {method:'DELETE'});
  closeDrawer(); refreshCounts(); switchTab(currentTab);
}
async function approveExercise(slug) {
  await fetch('/api/exercises/approve/'+slug, {method:'POST'});
  closeDrawer(); refreshCounts(); switchTab(currentTab);
}
async function restoreExercise(slug) {
  await fetch('/api/exercises/restore/'+slug, {method:'POST'});
  closeDrawer(); refreshCounts(); switchTab(currentTab);
}
async function permDelete(slug) {
  if (!confirm('Permanently delete this exercise?')) return;
  await fetch('/api/exercises/permanent/'+slug, {method:'DELETE'});
  closeDrawer(); refreshCounts(); switchTab(currentTab);
}
async function approveAll() {
  if (!confirm(`Approve all ${exercisesData.length} staged exercises?`)) return;
  await Promise.all(exercisesData.map(e => fetch('/api/exercises/approve/'+e.slug, {method:'POST'})));
  refreshCounts(); switchTab('exercises');switchSubTab('exercises','staging');
}
async function discardAll() {
  if (!confirm(`Discard all ${exercisesData.length} staged exercises?`)) return;
  await Promise.all(exercisesData.map(e => fetch('/api/exercises/'+e.slug, {method:'DELETE'})));
  refreshCounts(); switchTab('exercises');switchSubTab('exercises','staging');
}


// ── Equipment filter ──────────────────────────────────────────────────────────
let filterEquipmentOwned = false;
let ownedEquipmentNames = null;

async function getOwnedEquipment() {
  if (ownedEquipmentNames !== null) return ownedEquipmentNames;
  const res = await fetch('/api/settings');
  const s = await res.json();
  const raw = s.EQUIPMENT || '';
  ownedEquipmentNames = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return ownedEquipmentNames;
}

async function toggleEquipmentFilter() {
  filterEquipmentOwned = !filterEquipmentOwned;
  document.getElementById('eq-filter-toggle').classList.toggle('active', filterEquipmentOwned);
  if (filterEquipmentOwned) {
    ownedEquipmentNames = null;
    await getOwnedEquipment();
  }
  loadExercises('active');
}

// Patch renderGrid to respect equipment filter
const _origRenderGrid = renderGrid;
renderGrid = function(status) {
  _origRenderGrid(status);
};

// Override the list filtering step — monkey-patch applyFilters to call renderGrid which now has eq filter
const _origApplyFilters = applyFilters;
applyFilters = function() {
  filterCategory = document.getElementById('filter-category').value;
  filterMuscle = document.getElementById('filter-muscle').value;
  filterDifficulty = document.getElementById('filter-difficulty').value;
  const isFiltered = filterCategory || filterMuscle || filterDifficulty || filterEquipmentOwned;
  document.getElementById('filter-clear').style.display = isFiltered ? '' : 'none';
  renderGrid('active');
};

const _origClearFilters = clearFilters;
clearFilters = function() {
  filterCategory = filterMuscle = filterDifficulty = '';
  filterEquipmentOwned = false;
  document.getElementById('filter-category').value = '';
  document.getElementById('filter-muscle').value = '';
  document.getElementById('filter-difficulty').value = '';
  document.getElementById('filter-clear').style.display = 'none';
  document.getElementById('eq-filter-toggle').classList.remove('active');
  renderGrid('active');
};

// Wrap loadExercises to apply equipment filter after fetch
const _origLoadExercises = loadExercises;
loadExercises = async function(status) {
  const res = await fetch('/api/exercises?status=' + status + '&per_page=200');
  const data = await res.json();
  exercisesData = data.exercises || [];
  if (status === 'active' && filterEquipmentOwned) {
    const owned = await getOwnedEquipment();
    if (owned.length) {
      exercisesData = exercisesData.filter(e => {
        const eqList = (e.equipment_list || []).map(eq => (typeof eq === 'string' ? eq : '').toLowerCase()).filter(Boolean);
        if (!eqList.length) return true;
        return eqList.some(eq => owned.includes(eq));
      });
    }
  }
  renderGrid(status);
};

// ── Exercise progress ─────────────────────────────────────────────────────────
async function loadExerciseProgress(slug, container) {
  const data = await fetch('/api/exercises/' + slug + '/progress').then(r => r.json());
  if (!data.length) { container.innerHTML = ''; return; }

  const withRM = data.filter(d => d.best_1rm).slice(-10);
  const withVol = data.filter(d => d.volume > 0).slice(-10);

  if (!withRM.length && !withVol.length) { container.innerHTML = ''; return; }

  let html = '';

  if (withRM.length >= 1) {
    const best = Math.max(...withRM.map(d => d.best_1rm));
    const last = withRM[withRM.length - 1].best_1rm;
    const prev = withRM.length >= 2 ? withRM[withRM.length - 2].best_1rm : null;
    const trendPct = prev ? Math.round(((last - prev) / prev) * 100) : null;
    const trendHtml = trendPct !== null
      ? `<span class="${trendPct >= 0 ? 'progress-trend-up' : 'progress-trend-down'}">${trendPct >= 0 ? '+' : ''}${trendPct}%</span>`
      : '';

    html += `<div class="drawer-section">Estimated 1RM ${trendHtml}</div>`;
    html += `<div class="progress-stat-row">
      <div class="progress-stat"><div class="progress-stat-val">${Math.round(_wDisplay(last))} ${_wLabel()}</div><div class="progress-stat-label">Last</div></div>
      <div class="progress-stat"><div class="progress-stat-val">${Math.round(_wDisplay(best))} ${_wLabel()}</div><div class="progress-stat-label">Best</div></div>
      <div class="progress-stat"><div class="progress-stat-val">${withRM.length}</div><div class="progress-stat-label">Sessions</div></div>
    </div>`;

    if (withRM.length >= 2) {
      html += _buildSparkline(withRM.map(d => d.best_1rm), 'var(--amber)');
    }

    html += `<div class="progress-session-list">`;
    html += withRM.slice().reverse().slice(0, 5).map(d =>
      `<div class="progress-session-row">
        <span class="progress-session-date">${d.date.slice(5)}</span>
        <span class="progress-session-val">${Math.round(_wDisplay(d.best_1rm))} ${_wLabel()}</span>
      </div>`
    ).join('');
    html += `</div>`;
  }

  if (withVol.length >= 2) {
    const last = withVol[withVol.length - 1].volume;
    const prev = withVol.length >= 2 ? withVol[withVol.length - 2].volume : null;
    const trendPct = prev ? Math.round(((last - prev) / prev) * 100) : null;
    const trendHtml = trendPct !== null
      ? `<span class="${trendPct >= 0 ? 'progress-trend-up' : 'progress-trend-down'}">${trendPct >= 0 ? '+' : ''}${trendPct}%</span>`
      : '';

    html += `<div class="drawer-section" style="margin-top:12px">Volume (${_wLabel()}) ${trendHtml}</div>`;
    html += _buildSparkline(withVol.map(d => d.volume), 'var(--sage)');
  }

  container.innerHTML = html;
}

function _buildSparkline(values, color) {
  const W = 240, H = 54, pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = pad + (i / (n - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return [x, y];
  });
  const polyPts = pts.map(p => p.join(',')).join(' ');
  const areaPath = `M${pts[0].join(',')} ` + pts.slice(1).map(p => `L${p.join(',')}`).join(' ') +
    ` L${pts[n-1][0]},${H} L${pts[0][0]},${H} Z`;
  const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color}"/>`).join('');
  return `<div class="progress-chart">
    <svg class="progress-sparkline" viewBox="0 0 ${W} ${H}" height="54">
      <path d="${areaPath}" fill="${color}" opacity=".12"/>
      <polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>
  </div>`;
}

