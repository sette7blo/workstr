// ── Templates ─────────────────────────────────────────────────────────────────
let templateExercises = [];

async function loadTemplates() {
  const res = await fetch('/api/templates');
  const list = await res.json();
  const container = document.getElementById('templates-list');
  if (!list.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No templates yet. Create one to plan repeating workouts.</p>';
    return;
  }
  container.innerHTML = list.map(t => {
    const exes = (t.exercises||[]).map(e => esc(e.name||e.slug||'')).join(', ');
    return `<div class="template-card">
      <div class="template-card-name">${esc(t.name)}</div>
      <div class="template-card-meta">${t.category ? esc(t.category) + ' · ' : ''}${(t.exercises||[]).length} exercises</div>
      ${exes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${exes}</div>` : ''}
      <div class="template-card-actions">
        <button class="btn-sage" style="font-size:11px;height:26px" onclick="editTemplate(${t.id})">Edit</button>
        <button class="btn-danger" style="font-size:11px;height:26px" onclick="deleteTemplate(${t.id})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function openTemplateBuilder(id) {
  templateExercises = [];
  document.getElementById('tmpl-id').value = id || '';
  document.getElementById('tmpl-name').value = '';
  document.getElementById('tmpl-category').value = '';
  document.getElementById('tmpl-ex-list').innerHTML = '';
  document.getElementById('tmpl-ex-search').value = '';
  document.getElementById('tmpl-search-results').style.display = 'none';
  document.getElementById('template-modal').classList.add('open');
}

async function editTemplate(id) {
  const res = await fetch('/api/templates');
  const list = await res.json();
  const t = list.find(x => x.id === id);
  if (!t) return;
  templateExercises = t.exercises || [];
  document.getElementById('tmpl-id').value = id;
  document.getElementById('tmpl-name').value = t.name;
  document.getElementById('tmpl-category').value = t.category||'';
  renderTemplateExList();
  document.getElementById('template-modal').classList.add('open');
}

function renderTemplateExList() {
  document.getElementById('tmpl-ex-list').innerHTML = templateExercises.map((e,i) => `
    <div class="template-ex-item">
      <span class="template-ex-name">${esc(e.name||e.slug)}</span>
      <input class="template-ex-reps" value="${esc(e.reps||'8-12')}" placeholder="reps" onchange="templateExercises[${i}].reps=this.value">
      <div class="template-ex-remove" onclick="removeTemplateEx(${i})">x</div>
    </div>`).join('');
}

function removeTemplateEx(i) { templateExercises.splice(i,1); renderTemplateExList(); }

async function searchTemplateEx(q) {
  const results = document.getElementById('tmpl-search-results');
  if (!q) { results.style.display = 'none'; return; }
  const res = await fetch('/api/exercises?per_page=200');
  const data = await res.json();
  const filtered = (data.exercises||[]).filter(e => e.name.toLowerCase().includes(q.toLowerCase())).slice(0,8);
  if (!filtered.length) { results.style.display = 'none'; return; }
  results.style.display = '';
  results.innerHTML = filtered.map(e => `
    <div class="ex-search-result-item" onclick="addTemplateEx('${e.slug}','${esc(e.name)}')">
      ${esc(e.name)} <span style="font-size:11px;color:var(--text-muted)">${esc(e.muscle_group||'')}</span>
    </div>`).join('');
}

function addTemplateEx(slug, name) {
  templateExercises.push({slug, name, reps:'8-12'});
  renderTemplateExList();
  document.getElementById('tmpl-ex-search').value = '';
  document.getElementById('tmpl-search-results').style.display = 'none';
}

async function saveTemplate() {
  const id = document.getElementById('tmpl-id').value;
  const name = document.getElementById('tmpl-name').value.trim();
  if (!name) { alert('Name is required'); return; }
  const body = {
    name,
    category: document.getElementById('tmpl-category').value,
    exercises: templateExercises,
  };
  if (id) {
    await fetch('/api/templates/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  } else {
    await fetch('/api/templates', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  }
  closeTemplateModal();
  loadTemplates();
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await fetch('/api/templates/'+id, {method:'DELETE'});
  loadTemplates();
}

function closeTemplateModal() { document.getElementById('template-modal').classList.remove('open'); }

// ── Workouts (builder) ────────────────────────────────────────────────────────
let _workoutCache = {};

async function loadWorkouts() {
  _workoutCache = {};
  const res = await fetch('/api/workouts');
  const list = await res.json();
  const container = document.getElementById('workouts-list');
  const empty = document.getElementById('workouts-empty');
  if (!list.length) { container.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  container.innerHTML = list.map(w => `
    <div class="workout-card" id="wk-card-${w.id}">
      <div class="workout-card-header" onclick="toggleWorkoutCard(${w.id})">
        <div class="workout-card-map" id="wk-map-${w.id}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
        </div>
        <div class="workout-card-info">
          <div class="workout-card-name">${esc(w.name)}</div>
          <div class="workout-card-meta" id="wk-meta-${w.id}">${w.exercise_count||0} exercise${w.exercise_count!==1?'s':''}${w.description?' · '+esc(w.description):''}</div>
          <div class="workout-card-muscles" id="wk-muscles-${w.id}"></div>
        </div>
        <svg class="workout-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="workout-card-body" id="wk-body-${w.id}"></div>
    </div>`).join('');

  // Load body maps for all workout cards
  list.forEach(w => _loadWorkoutCardMap(w.id));
}

function _estimateWorkoutMin(exercises) {
  const SET_SEC = 45;
  let total = 0;
  exercises.forEach(e => {
    const sets = e.sets || 3;
    const rest = e.rest_sec || 90;
    total += sets * SET_SEC + (sets - 1) * rest;
  });
  return Math.round(total / 60);
}

async function _loadWorkoutCardMap(wid) {
  const data = await _fetchWorkoutDetail(wid);
  if (!data) return;
  const exercises = data.exercises || [];

  // Build composite body map
  const mapContainer = document.getElementById('wk-map-' + wid);
  if (mapContainer) {
    const allPrimary = new Set();
    const allSecondary = new Set();
    exercises.forEach(e => {
      const p = _canonMuscle(e.muscle_group);
      if (p) allPrimary.add(p);
      let muscles = e.muscles || [];
      if (typeof muscles === 'string') try { muscles = JSON.parse(muscles); } catch(err) { muscles = []; }
      muscles.forEach(m => { const c = _canonMuscle(m); if (c && c !== p) allSecondary.add(c); });
    });
    // Don't count as secondary if already primary
    allPrimary.forEach(p => allSecondary.delete(p));
    _buildWorkoutBodyMap(mapContainer, allPrimary, allSecondary);
  }

  // Show muscle summary text
  const muscleEl = document.getElementById('wk-muscles-' + wid);
  if (muscleEl) {
    const groups = [...new Set(exercises.map(e => e.muscle_group).filter(Boolean))];
    muscleEl.textContent = groups.join(', ');
  }

  // Show estimated duration on card meta
  if (exercises.length) {
    const metaEl = document.getElementById('wk-meta-' + wid);
    if (metaEl) {
      const mins = _estimateWorkoutMin(exercises);
      const timeStr = mins >= 60 ? Math.floor(mins/60) + 'h ' + (mins%60 ? mins%60 + ' min' : '') : mins + ' min';
      const existing = metaEl.textContent;
      metaEl.textContent = existing + ' · ~' + timeStr.trim();
    }
  }
}

async function _fetchWorkoutDetail(wid) {
  if (_workoutCache[wid]) return _workoutCache[wid];
  const res = await fetch('/api/workouts/' + wid);
  const data = await res.json();
  _workoutCache[wid] = data;
  return data;
}

function _buildWorkoutBodyMap(container, primaryMuscles, secondaryMuscles) {
  const src = document.getElementById('body-map-svg');
  if (!src) return;
  const svg = src.cloneNode(true);
  svg.removeAttribute('id');
  svg.querySelectorAll('text').forEach(t => t.remove());
  svg.querySelectorAll('[data-muscle]').forEach(el => {
    const m = el.dataset.muscle;
    if (primaryMuscles.has(m)) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.85');
    } else if (secondaryMuscles.has(m)) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.3');
    } else {
      el.setAttribute('fill', '#ede7dc');
      el.removeAttribute('opacity');
    }
  });
  container.innerHTML = '';
  container.appendChild(svg);
}

function _buildSummaryBodyMap(container, primaryMuscles, secondaryMuscles) {
  const src = document.getElementById('body-map-svg');
  if (!src) return;
  const svg = src.cloneNode(true);
  svg.removeAttribute('id');
  svg.querySelectorAll('text').forEach(t => t.remove());
  svg.querySelectorAll('[data-muscle]').forEach(el => {
    const m = el.dataset.muscle;
    if (primaryMuscles.has(m)) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.9');
    } else if (secondaryMuscles.has(m)) {
      el.setAttribute('fill', 'var(--amber)');
      el.setAttribute('opacity', '0.35');
    } else {
      el.setAttribute('fill', '#ede7dc');
      el.removeAttribute('opacity');
    }
  });
  svg.querySelectorAll('line, path, circle, rect, ellipse').forEach(el => {
    if (!el.dataset.muscle) {
      const stroke = el.getAttribute('stroke');
      if (stroke && stroke !== 'none') el.setAttribute('stroke', '#c8bfb3');
    }
  });
  container.innerHTML = '';
  container.appendChild(svg);
}

async function toggleWorkoutCard(wid) {
  const card = document.getElementById('wk-card-' + wid);
  const body = document.getElementById('wk-body-' + wid);
  if (!card || !body) return;

  if (card.classList.contains('expanded')) {
    card.classList.remove('expanded');
    return;
  }

  // Collapse any other open card
  document.querySelectorAll('.workout-card.expanded').forEach(c => c.classList.remove('expanded'));

  // Load detail if not yet rendered
  if (!body.innerHTML.trim()) {
    body.innerHTML = '<div style="padding:14px 0;text-align:center;font-size:12px;color:var(--text-muted)">Loading...</div>';
    card.classList.add('expanded');
    const data = await _fetchWorkoutDetail(wid);
    _renderWorkoutCardBody(body, data, wid);
  } else {
    card.classList.add('expanded');
  }
}

function _renderWorkoutCardBody(body, data, wid) {
  const exercises = data.exercises || [];
  if (!exercises.length) {
    body.innerHTML = '<p style="padding:12px 0;font-size:12px;color:var(--text-muted)">No exercises yet. Edit this workout to add some.</p>';
    return;
  }

  const exHtml = exercises.map((e, i) => {
    const imgUrl = e.image_url ? (e.image_url.startsWith('http') ? e.image_url : '/' + e.image_url) : null;
    const imgHtml = imgUrl
      ? `<img class="wk-ex-img" src="${esc(imgUrl)}" alt="" loading="lazy">`
      : `<div class="wk-ex-img-placeholder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
    const shorthand = `${e.sets||3} x ${esc(e.reps||'8-12')}${e.weight ? ' @ ' + _wFmt(e.weight) : ''}`;
    const ssBadge = e.superset_group ? `<span class="wk-ex-ss-badge">SS ${esc(e.superset_group)}</span>` : '';
    const musclePill = e.muscle_group ? `<span class="wk-ex-muscle-pill">${esc(e.muscle_group)}</span>` : '';
    return `<div class="wk-ex-item" id="wk-ex-${wid}-${i}">
      <div class="wk-ex-header" onclick="toggleWkEx(${wid},${i})">
        ${imgHtml}
        <div class="wk-ex-info">
          <div class="wk-ex-name">${esc(e.exercise_name || e.exercise_slug)}${ssBadge}</div>
          <div class="wk-ex-short">${shorthand}</div>
        </div>
        ${musclePill}
        <svg class="wk-ex-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="wk-ex-detail">
        <div class="wk-ex-detail-grid">
          <div class="wk-ex-detail-cell"><div class="wk-ex-detail-val">${e.sets||3}</div><div class="wk-ex-detail-label">Sets</div></div>
          <div class="wk-ex-detail-cell"><div class="wk-ex-detail-val">${esc(e.reps||'8-12')}</div><div class="wk-ex-detail-label">Reps</div></div>
          <div class="wk-ex-detail-cell"><div class="wk-ex-detail-val">${e.weight ? _wFmt(e.weight) : '—'}</div><div class="wk-ex-detail-label">Weight</div></div>
          <div class="wk-ex-detail-cell"><div class="wk-ex-detail-val">${e.rest_sec||90}s</div><div class="wk-ex-detail-label">Rest</div></div>
        </div>
        ${e.notes ? `<div class="wk-ex-detail-note">${esc(e.notes)}</div>` : ''}
        ${e.difficulty ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Difficulty: ${esc(e.difficulty)}</div>` : ''}
        ${e.category ? `<div style="font-size:10px;color:var(--text-muted)">Category: ${esc(e.category)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div style="padding-top:12px">${exHtml}</div>
    <div class="workout-card-actions">
      <button class="btn-primary" style="height:32px;padding:0 14px;font-size:12px" onclick="event.stopPropagation();startWorkoutSession(${data.id})">Start</button>
      <button class="btn-outline" style="height:32px;padding:0 12px;font-size:12px" onclick="event.stopPropagation();editWorkout(${data.id})">Edit</button>
      <button class="btn-danger" style="height:32px;padding:0 12px;font-size:12px" onclick="event.stopPropagation();deleteWorkout(${data.id})">Delete</button>
    </div>`;
}

function toggleWkEx(wid, idx) {
  const el = document.getElementById(`wk-ex-${wid}-${idx}`);
  if (el) el.classList.toggle('open');
}

function openWorkoutBuilder(id) {
  wbExercises = [];
  document.getElementById('wb-id').value = id || '';
  document.getElementById('wb-name').value = '';
  document.getElementById('wb-desc').value = '';
  const wbSearch = document.getElementById('wb-ex-search');
  if (wbSearch) wbSearch.value = '';
  const wbResults = document.getElementById('wb-search-results');
  if (wbResults) wbResults.style.display = 'none';
  document.getElementById('wb-ex-list').innerHTML = '';
  document.getElementById('workout-builder-title').textContent = 'New Workout';
  document.getElementById('workout-builder-modal').classList.add('open');
}

async function editWorkout(id) {
  const res = await fetch('/api/workouts/' + id);
  const w = await res.json();
  wbExercises = (w.exercises || []).map(e => ({
    id: e.id, slug: e.exercise_slug, name: e.exercise_name || e.exercise_slug,
    sets: e.sets, reps: e.reps, weight: e.weight, rest_sec: e.rest_sec,
    image_url: e.image_url || '', superset_group: e.superset_group || null,
  }));
  document.getElementById('wb-id').value = id;
  document.getElementById('wb-name').value = w.name;
  document.getElementById('wb-desc').value = w.description || '';
  const wbSearch = document.getElementById('wb-ex-search');
  if (wbSearch) wbSearch.value = '';
  const wbResults = document.getElementById('wb-search-results');
  if (wbResults) wbResults.style.display = 'none';
  document.getElementById('workout-builder-title').textContent = 'Edit Workout';
  renderWbExList();
  document.getElementById('workout-builder-modal').classList.add('open');
}

function closeWorkoutBuilder() { document.getElementById('workout-builder-modal').classList.remove('open'); }

function renderWbExList() {
  const container = document.getElementById('wb-ex-list');
  if (!wbExercises.length) { container.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px 0">No exercises yet. Search above to add.</p>'; return; }
  const parts = [];
  wbExercises.forEach((e, i) => {
    const sgBadge = e.superset_group ? `<span class="wex-superset-badge">SS ${esc(e.superset_group)}</span>` : '';
    parts.push(`<div class="wex-row">
      <div class="wex-move-btns">
        <div class="wex-move-btn" onclick="moveWbEx(${i},-1)">&#8593;</div>
        <div class="wex-move-btn" onclick="moveWbEx(${i},1)">&#8595;</div>
      </div>
      ${e.image_url ? `<img src="${esc(e.image_url)}" alt="" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0" loading="lazy">` : ''}
      <div class="wex-info">
        <div class="wex-name">${esc(e.name)}${sgBadge}</div>
        <div class="wex-params">
          <div class="wex-param-group">
            <div class="wex-param-label">Sets</div>
            <input class="wex-param-input" type="number" value="${e.sets||3}" min="1" max="20" onchange="wbExercises[${i}].sets=parseInt(this.value)||3">
          </div>
          <div class="wex-param-group">
            <div class="wex-param-label">Reps</div>
            <input class="wex-param-input" type="text" value="${e.reps||'8-12'}" style="width:64px" onchange="wbExercises[${i}].reps=this.value">
          </div>
          <div class="wex-param-group">
            <div class="wex-param-label">${_wLabel()}</div>
            <input class="wex-param-input" type="number" value="${e.weight ? _wDisplay(e.weight) : ''}" placeholder="—" min="0" onchange="wbExercises[${i}].weight=_wStore(parseFloat(this.value))||null">
          </div>
          <div class="wex-param-group">
            <div class="wex-param-label">Rest</div>
            <input class="wex-param-input" type="number" value="${e.rest_sec||90}" min="0" step="5" onchange="wbExercises[${i}].rest_sec=parseInt(this.value)||90">
          </div>
        </div>
      </div>
      <div class="wex-remove" onclick="removeWbEx(${i})">&#x2715;</div>
    </div>`);
    if (i < wbExercises.length - 1) {
      const next = wbExercises[i + 1];
      const linked = e.superset_group && e.superset_group === next.superset_group;
      parts.push(`<div class="wex-superset-connector">
        <div class="wex-superset-line"></div>
        <button class="wex-superset-btn ${linked ? 'linked' : ''}" onclick="toggleSupersetLink(${i})">${linked ? 'Superset — click to unlink' : '+ Superset'}</button>
        <div class="wex-superset-line"></div>
      </div>`);
    }
  });
  container.innerHTML = parts.join('');
}

function moveWbEx(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= wbExercises.length) return;
  [wbExercises[i], wbExercises[j]] = [wbExercises[j], wbExercises[i]];
  renderWbExList();
}

function removeWbEx(i) { wbExercises.splice(i, 1); renderWbExList(); }

function toggleSupersetLink(i) {
  const a = wbExercises[i], b = wbExercises[i + 1];
  if (!a || !b) return;
  if (a.superset_group && a.superset_group === b.superset_group) {
    // Unlink: remove group from both (and any others sharing this group)
    const g = a.superset_group;
    wbExercises.forEach(e => { if (e.superset_group === g) e.superset_group = null; });
  } else {
    // Link: assign next available group letter
    const used = new Set(wbExercises.map(e => e.superset_group).filter(Boolean));
    let letter = 'A';
    while (used.has(letter)) letter = String.fromCharCode(letter.charCodeAt(0) + 1);
    a.superset_group = letter;
    b.superset_group = letter;
  }
  renderWbExList();
}

async function searchWbExercises(q) {
  const results = document.getElementById('wb-search-results');
  if (!q) { results.style.display = 'none'; return; }
  const res = await fetch('/api/exercises?per_page=200');
  const data = await res.json();
  const filtered = (data.exercises||[]).filter(e => e.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!filtered.length) { results.style.display = 'none'; return; }
  results.style.display = '';
  results.innerHTML = filtered.map(e =>
    `<div class="ex-search-result-item" onclick="addWbExercise('${e.slug}','${esc(e.name)}')">
      ${esc(e.name)} <span style="font-size:11px;color:var(--text-muted)">${esc(e.muscle_group||'')}</span>
    </div>`).join('');
}

function addWbExercise(slug, name, opts = {}) {
  const existing = wbExercises.find(e => e.slug === slug);
  if (!existing) wbExercises.push({
    slug, name,
    sets: opts.sets || 3,
    reps: opts.reps || '8-12',
    weight: opts.weight || null,
    rest_sec: opts.rest_sec || 90,
    image_url: opts.image_url || '',
    superset_group: null,
  });
  renderWbExList();
  const wbSearch = document.getElementById('wb-ex-search');
  if (wbSearch) wbSearch.value = '';
  const wbResults = document.getElementById('wb-search-results');
  if (wbResults) wbResults.style.display = 'none';
}

async function saveWorkout() {
  const id = document.getElementById('wb-id').value;
  const name = document.getElementById('wb-name').value.trim();
  if (!name) { alert('Name is required'); return; }
  const description = document.getElementById('wb-desc').value.trim() || null;

  let wid;
  if (id) {
    const res = await fetch('/api/workouts/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description})});
    const w = await res.json();
    wid = w.id;
    // Remove all old exercises and re-add in order
    const oldRes = await fetch('/api/workouts/'+wid);
    const oldW = await oldRes.json();
    await Promise.all((oldW.exercises||[]).map(e => fetch(`/api/workouts/${wid}/exercises/${e.id}`,{method:'DELETE'})));
  } else {
    const res = await fetch('/api/workouts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description})});
    const w = await res.json();
    wid = w.id;
  }

  for (const e of wbExercises) {
    await fetch(`/api/workouts/${wid}/exercises`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({exercise_slug:e.slug,sets:e.sets,reps:e.reps,weight:e.weight,rest_sec:e.rest_sec,superset_group:e.superset_group||null}),
    });
  }

  closeWorkoutBuilder();
  loadWorkouts();
}

async function deleteWorkout(id) {
  if (!confirm('Delete this workout?')) return;
  await fetch('/api/workouts/'+id,{method:'DELETE'});
  loadWorkouts();
}

// ── Session logging ────────────────────────────────────────────────────────────
let _session = null;        // {id, workout_id, exercises:[{slug,name,sets,reps,weight,rest_sec}], ...}
let _sessionExIdx = 0;      // current exercise index
let _sessionSetCounts = {}; // slug -> number of sets shown
let _sessionRestTimer = null;
let _exercisePR = {};       // slug -> historical best estimated 1RM
let _sessionPRs = [];       // [{slug, name, rm}] PRs set this session
let _sessionRestTotal = 0;
let _sessionRestRemaining = 0;
let _sessionElapsedTimer = null;
let _sessionStartTime = null;
let _sessionLoggedSets = {}; // slug -> Set of set indices logged in current session
let _exerciseCache = {};    // slug -> exercise detail (for instructions)
let _pickerMuscle = '';     // active muscle group chip filter

async function startWorkoutSession(workoutId) {
  const wRes = await fetch('/api/workouts/' + workoutId);
  const w = await wRes.json();
  if (!w.exercises?.length) { alert('This workout has no exercises yet. Edit it first.'); return; }

  const sRes = await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workout_id:workoutId})});
  const s = await sRes.json();
  _session = {id:s.id, workout_id:workoutId, workoutName:w.name, exercises:w.exercises};
  _sessionExIdx = 0;
  _sessionSetCounts = {};
  _sessionLoggedSets = {};
  _exercisePR = {};
  _sessionPRs = [];
  _openSessionOverlay();
}


// Keep screen awake during workout (Wake Lock API + video fallback for HTTP)
let _wakeLock = null;
let _noSleepVid = null;

async function _requestWakeLock() {
  if (_wakeLock || _noSleepVid) return;
  if ('wakeLock' in navigator) {
    try {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
      return;
    } catch(e) {}
  }
  try {
    _noSleepVid = document.createElement('video');
    _noSleepVid.setAttribute('playsinline', '');
    _noSleepVid.muted = true;
    _noSleepVid.loop = true;
    _noSleepVid.style.cssText = 'position:fixed;top:-2px;left:-2px;width:1px;height:1px;opacity:0;pointer-events:none';
    _noSleepVid.innerHTML = '<source src="/nosleep.webm" type="video/webm"><source src="/nosleep.mp4" type="video/mp4">';
    document.body.appendChild(_noSleepVid);
    await _noSleepVid.play();
  } catch(e) {
    if (_noSleepVid) { _noSleepVid.remove(); _noSleepVid = null; }
  }
}

function _releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
  if (_noSleepVid) { _noSleepVid.pause(); _noSleepVid.remove(); _noSleepVid = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _session) _requestWakeLock();
});

function _openSessionOverlay() {
  document.getElementById('session-overlay').classList.add('open');
  _requestWakeLock();
  _sessionStartTime = Date.now();
  clearInterval(_sessionElapsedTimer);
  _sessionElapsedTimer = setInterval(() => {
    const s = Math.floor((Date.now() - _sessionStartTime) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const el = document.getElementById('session-elapsed');
    if (el) el.textContent = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }, 1000);
  _renderSessionEx();
}

function _renderSessionNav() {
  const nav = document.getElementById('session-ex-nav');
  nav.innerHTML = _session.exercises.map((e,i) => {
    const cls = i < _sessionExIdx ? 'done' : i === _sessionExIdx ? 'current' : '';
    return `<div class="session-ex-dot ${cls}" onclick="jumpSessionEx(${i})">${i+1}</div>`;
  }).join('');
}

async function _renderSessionEx() {
  const ex = _session.exercises[_sessionExIdx];
  if (!ex) return;
  const slug = ex.exercise_slug;
  const targetSets = ex.sets || 3;
  const targetReps = ex.reps || '8-12';
  const restSec = ex.rest_sec || 90;

  document.getElementById('session-title').textContent = _session.workoutName || 'Session';
  document.getElementById('session-meta').textContent = `Exercise ${_sessionExIdx+1} of ${_session.exercises.length}`;
  _renderSessionNav();

  // Fetch last session sets for pre-fill + per-set indicators
  const lastRes = await fetch(`/api/exercises/${slug}/last-sets?before_session_id=${_session.id}`);
  const lastSets = await lastRes.json();

  // Load historical best 1RM for PR detection (once per exercise per session)
  if (_exercisePR[slug] === undefined) {
    const prog = await fetch('/api/exercises/'+slug+'/progress').then(r=>r.json()).catch(()=>[]);
    const bests = prog.map(d => d.best_1rm).filter(Boolean);
    _exercisePR[slug] = bests.length ? Math.max(...bests) : 0;
  }

  if (!_sessionSetCounts[slug]) _sessionSetCounts[slug] = targetSets;
  const numSets = _sessionSetCounts[slug];

  const imgUrl = ex.image_url ? (ex.image_url.startsWith('http') ? ex.image_url : '/'+ex.image_url) : null;

  // Compute progression suggestion from last session
  const prog = _calcProgression(lastSets, targetReps, ex.weight);

  const doneSetsForLock = _sessionLoggedSets[slug] || new Set();
  const setRows = Array.from({length:numSets}, (_,i) => {
    const last = lastSets[i];
    const prevHint = last
      ? `<span class="session-set-prev">prev: ${last.actual_reps||'?'}${last.actual_weight?' @ '+_wFmt(last.actual_weight):''}</span>`
      : '';
    const progHint = prog
      ? `<span class="session-set-prog">suggested: ${prog.reps} reps @ ${_wFmt(prog.weight)} (${prog.note})</span>`
      : '';
    const phReps = last?.actual_reps != null ? last.actual_reps : targetReps;
    const phWeight = last?.actual_weight ? _wDisplay(last.actual_weight) : (ex.weight ? _wDisplay(ex.weight) : _wLabel());
    const alreadyDone = doneSetsForLock.has(i);
    const locked = !alreadyDone && i > 0 && !doneSetsForLock.has(i - 1);
    return `<div class="session-set-row${locked ? ' locked' : ''}">
      <div class="session-set-num" id="snum-${i}">${i+1}</div>
      <input class="session-set-input" id="sreps-${i}" type="number" placeholder="${phReps}" value="" min="0"${locked ? ' disabled' : ''}>
      <input class="session-set-input" id="sweight-${i}" type="number" placeholder="${phWeight}" value="" min="0" step="0.5"${locked ? ' disabled' : ''}>
      <button class="session-log-btn" id="slog-${i}" onclick="logSessionSet(${i},${restSec},'${slug}','${targetReps}',${ex.weight||'null'})"${locked ? ' disabled' : ''}>Log</button>
    </div>${prevHint}${progHint}`;
  }).join('');

  // Fetch instructions (cached)
  if (!_exerciseCache[slug]) _exerciseCache[slug] = fetch('/api/exercises/'+slug).then(r=>r.json());
  const exDetail = await _exerciseCache[slug];
  const instructions = exDetail?.full?.instructions || [];
  const instructionsHtml = instructions.length ? `
    <div class="session-instructions">
      <div class="session-instructions-toggle" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('span').textContent=this.nextElementSibling.classList.contains('open')?'hide':'how to perform'">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>how to perform</span>
      </div>
      <div class="session-instructions-body">
        ${instructions.map((s,i) => `<div class="session-instructions-step">${i+1}. ${esc(s)}</div>`).join('')}
      </div>
    </div>` : '';

  document.getElementById('session-body').innerHTML = `
    ${imgUrl ? `<img src="${imgUrl}" alt="" style="width:100%;max-width:400px;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:16px;display:block">` : ''}
    <div class="session-ex-name">${esc(ex.exercise_name||slug)}${ex.superset_group ? `<span class="wex-superset-badge" style="font-size:10px;padding:2px 6px">SS ${esc(ex.superset_group)}</span>` : ''}</div>
    <div class="session-ex-target">${targetSets} sets × ${targetReps}${ex.weight ? ' @ '+_wFmt(ex.weight) : ''} · ${restSec}s rest${ex.superset_group ? ' · superset' : ''}</div>
    <div style="margin-bottom:16px"></div>
    <div class="session-sets">${setRows}</div>
    <div class="session-add-set" onclick="addSessionSet('${slug}')">+ Add set</div>
    ${instructionsHtml}`;

  // Restore done state for sets already logged in this session
  const doneSets = _sessionLoggedSets[slug] || new Set();
  doneSets.forEach(i => {
    const numEl = document.getElementById('snum-'+i);
    const logBtn = document.getElementById('slog-'+i);
    if (numEl) numEl.classList.add('done');
    if (logBtn) { logBtn.textContent = 'Done'; logBtn.classList.add('done'); logBtn.disabled = true; }
  });

  const isLast = _sessionExIdx >= _session.exercises.length - 1;
  document.getElementById('session-footer').innerHTML = `
    ${_sessionExIdx > 0 ? `<button class="session-prev-btn" onclick="jumpSessionEx(${_sessionExIdx-1})">Back</button>` : ''}
    ${isLast
      ? `<button class="session-finish-btn" onclick="finishSession()">Finish Workout</button>`
      : `<button class="session-next-btn" onclick="jumpSessionEx(${_sessionExIdx+1})">Next</button>`}`;
}

async function logSessionSet(setIdx, restSec, slug, prescReps, prescWeight) {
  const reps = parseInt(document.getElementById('sreps-'+setIdx)?.value) || null;
  const rawWeight = parseFloat(document.getElementById('sweight-'+setIdx)?.value) || null;
  if (!reps && !rawWeight) {
    const inp = document.getElementById('sreps-'+setIdx);
    if (inp) { inp.focus(); inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); }
    return;
  }
  const weight = rawWeight != null ? _wStore(rawWeight) : null;

  await fetch(`/api/sessions/${_session.id}/sets`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      exercise_slug:slug, set_number:setIdx+1,
      actual_reps:reps, actual_weight:weight,
      prescribed_reps:prescReps, prescribed_weight:prescWeight,
    }),
  });

  if (!_sessionLoggedSets[slug]) _sessionLoggedSets[slug] = new Set();
  _sessionLoggedSets[slug].add(setIdx);

  const numEl = document.getElementById('snum-'+setIdx);
  const logBtn = document.getElementById('slog-'+setIdx);
  if (numEl) numEl.classList.add('done');
  if (logBtn) { logBtn.textContent='Done'; logBtn.classList.add('done'); logBtn.disabled = true; }

  // Unlock next set and carry weight forward
  const nextRow = document.getElementById('slog-'+(setIdx+1))?.closest('.session-set-row');
  if (nextRow && nextRow.classList.contains('locked')) {
    nextRow.classList.remove('locked');
    nextRow.querySelectorAll('input, button').forEach(el => el.disabled = false);
  }
  const nextWeightEl = document.getElementById('sweight-'+(setIdx+1));
  if (nextWeightEl && !nextWeightEl.value && rawWeight) nextWeightEl.value = rawWeight;
  const nextRepsEl = document.getElementById('sreps-'+(setIdx+1));
  if (nextRepsEl && !nextRepsEl.value && reps) nextRepsEl.value = reps;

  // PR detection: Epley 1RM estimate
  if (reps && weight) {
    const estimated1rm = weight * (1 + reps / 30);
    const prevBest = _exercisePR[slug] || 0;
    if (estimated1rm > prevBest && prevBest > 0) {
      _exercisePR[slug] = estimated1rm;
      const exName = _session?.exercises?.find(e => e.exercise_slug === slug)?.exercise_name || slug;
      _sessionPRs.push({slug, name: exName, rm: Math.round(estimated1rm * 10) / 10});
      showPrToast(Math.round(_wDisplay(estimated1rm) * 10) / 10);
    }
  }

  // Superset auto-navigation: jump to next exercise in same group with no rest
  const curEx = _session?.exercises?.[_sessionExIdx];
  const supersetGroup = curEx?.superset_group;
  if (supersetGroup) {
    const nextIdx = _findNextInSuperset(supersetGroup, _sessionExIdx);
    if (nextIdx !== -1) {
      jumpSessionEx(nextIdx);
      return; // skip rest between superset exercises
    }
  }

  // Check if all sets for this exercise are done — auto-advance after rest
  const totalSetsForEx = _sessionSetCounts[slug] || 0;
  const loggedSetsForEx = _sessionLoggedSets[slug]?.size || 0;
  const allSetsDone = loggedSetsForEx >= totalSetsForEx && totalSetsForEx > 0;

  startSessionRest(restSec, allSetsDone);
}

function _findNextInSuperset(group, currentIdx) {
  const exes = _session?.exercises || [];
  for (let i = currentIdx + 1; i < exes.length; i++) {
    if (exes[i].superset_group === group) return i;
  }
  for (let i = 0; i < currentIdx; i++) {
    if (exes[i].superset_group === group) return i;
  }
  return -1;
}

function showPrToast(rm) {
  const el = document.getElementById('pr-toast');
  if (!el) return;
  el.innerHTML = 'New PR<br><span style="font-size:13px;font-weight:500;opacity:.85">~' + rm + _wLabel() + ' estimated 1RM</span>';
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function addSessionSet(slug) {
  _sessionSetCounts[slug] = (_sessionSetCounts[slug] || 0) + 1;
  _renderSessionEx();
}

function jumpSessionEx(i) {
  if (i < 0 || i >= _session.exercises.length) return;
  _sessionExIdx = i;
  _renderSessionEx();
}

function startSessionRest(sec, autoAdvance) {
  const overlay = document.getElementById('session-rest-overlay');
  overlay.classList.add('show');
  _sessionRestTotal = sec;
  _sessionRestRemaining = sec;
  _updateRestDisplay();
  clearInterval(_sessionRestTimer);
  _sessionRestTimer = setInterval(() => {
    _sessionRestRemaining--;
    _updateRestDisplay();
    if (_sessionRestRemaining <= 0) {
      clearInterval(_sessionRestTimer);
      overlay.classList.remove('show');
      if (autoAdvance && _session?.exercises) {
        const nextIdx = _sessionExIdx + 1;
        if (nextIdx < _session.exercises.length) {
          jumpSessionEx(nextIdx);
        }
      }
    }
  }, 1000);
}

function _updateRestDisplay() {
  document.getElementById('session-rest-val').textContent = _sessionRestRemaining;
  const circumference = 339.3;
  const fg = document.getElementById('rest-ring-fg');
  if (fg) {
    const offset = _sessionRestTotal > 0 ? circumference * (1 - _sessionRestRemaining / _sessionRestTotal) : 0;
    fg.style.strokeDashoffset = Math.max(0, Math.min(circumference, offset));
    fg.style.stroke = _sessionRestRemaining <= 5 ? '#ef4444' : 'var(--amber)';
  }
}

function adjustRest(delta) {
  _sessionRestRemaining = Math.max(5, _sessionRestRemaining + delta);
  if (_sessionRestTotal < _sessionRestRemaining) _sessionRestTotal = _sessionRestRemaining;
  _updateRestDisplay();
}

function skipSessionRest() {
  clearInterval(_sessionRestTimer);
  document.getElementById('session-rest-overlay').classList.remove('show');
}

async function finishSession() {
  if (!_session) return;
  const totalLogged = Object.values(_sessionLoggedSets).reduce((n, s) => n + s.size, 0);
  if (totalLogged === 0) { alert('Log at least one set before finishing.'); return; }
  clearInterval(_sessionElapsedTimer);
  const elapsedSec = _sessionStartTime ? Math.floor((Date.now() - _sessionStartTime) / 1000) : 0;
  await fetch(`/api/sessions/${_session.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  const sRes = await fetch('/api/sessions/' + _session.id);
  const s = await sRes.json();
  const sets = s.sets || [];
  const totalSets = sets.length;
  const totalVolume = Math.round(sets.reduce((acc, st) => acc + ((st.actual_reps||0) * (st.actual_weight||0)), 0));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  document.getElementById('summary-title').textContent = _session.workoutName || 'Workout Complete';
  document.getElementById('summary-sub').textContent = `${_session.exercises.length} exercise${_session.exercises.length!==1?'s':''}`;

  // Build summary body map from session exercises
  const summaryMapEl = document.getElementById('summary-body-map');
  const allPrimary = new Set();
  const allSecondary = new Set();
  _session.exercises.forEach(e => {
    const p = _canonMuscle(e.muscle_group);
    if (p) allPrimary.add(p);
    let muscles = e.muscles || [];
    if (typeof muscles === 'string') try { muscles = JSON.parse(muscles); } catch(err) { muscles = []; }
    muscles.forEach(m => { const c = _canonMuscle(m); if (c && c !== p) allSecondary.add(c); });
  });
  allPrimary.forEach(p => allSecondary.delete(p));
  _buildSummaryBodyMap(summaryMapEl, allPrimary, allSecondary);

  document.getElementById('summary-stats').innerHTML = [
    {val: durationLabel, label: 'Duration'},
    {val: totalSets, label: 'Sets'},
    {val: totalVolume > 0 ? Math.round(_wDisplay(totalVolume)) + ' ' + _wLabel() : '—', label: 'Volume'},
    {val: _session.exercises.length, label: 'Exercises'},
  ].map(st => `<div class="session-summary-stat">
    <div class="session-summary-stat-val">${st.val}</div>
    <div class="session-summary-stat-label">${st.label}</div>
  </div>`).join('');

  // PRs
  const prSection = document.getElementById('summary-prs');
  const uniquePRs = _sessionPRs.filter((p, i, arr) => arr.findIndex(x => x.slug === p.slug) === i);
  if (uniquePRs.length) {
    document.getElementById('summary-pr-list').innerHTML = uniquePRs.map(p =>
      `<span class="summary-pr-chip">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        ${esc(p.name)} ~${Math.round(_wDisplay(p.rm))}${_wLabel()} 1RM
      </span>`
    ).join('');
    prSection.style.display = '';
  } else { prSection.style.display = 'none'; }

  // vs last time comparison — group current sets by exercise, fetch previous
  const slugs = [...new Set(sets.map(s => s.exercise_slug))];
  const compSection = document.getElementById('summary-comparison');
  if (slugs.length) {
    const prevData = await Promise.all(slugs.map(sl =>
      fetch(`/api/exercises/${sl}/last-sets?before_session_id=${_session.id}`).then(r => r.json()).catch(() => [])
    ));
    const rows = slugs.map((sl, i) => {
      const cur = sets.filter(s => s.exercise_slug === sl);
      const prev = prevData[i];
      const curVol = cur.reduce((a, s) => a + ((s.actual_reps||0) * (s.actual_weight||0)), 0);
      const prevVol = prev.reduce((a, s) => a + ((s.actual_reps||0) * (s.actual_weight||0)), 0);
      const exName = _session.exercises.find(e => e.exercise_slug === sl)?.exercise_name || sl;
      let delta = '', cls = 'same';
      if (prevVol > 0 && curVol > 0) {
        const pct = Math.round(((curVol - prevVol) / prevVol) * 100);
        if (pct > 0) { delta = '+' + pct + '%'; cls = 'up'; }
        else if (pct < 0) { delta = pct + '%'; cls = 'down'; }
        else { delta = '='; cls = 'same'; }
      } else if (!prevVol) { delta = 'new'; cls = 'same'; }
      return `<div class="summary-ex-row">
        <span class="summary-ex-name">${esc(exName)}</span>
        <span class="summary-delta ${cls}">${delta}</span>
      </div>`;
    }).join('');
    document.getElementById('summary-comparison-list').innerHTML = rows;
    compSection.style.display = '';
  } else { compSection.style.display = 'none'; }

  document.getElementById('session-summary-overlay').classList.add('show');
}

async function closeSummary() {
  // Clean up temporary workout if this was a quick workout from recovery
  if (_session?.isTemporary && _session?.workout_id) {
    try { await fetch('/api/workouts/' + _session.workout_id, {method: 'DELETE'}); } catch(e) {}
  }
  document.getElementById('session-summary-overlay').classList.remove('show');
  _closeSessionOverlay();
  switchTab('planner');
  switchSubTab('planner', 'history');
  loadHistory();
}

function _bodymapToBlob() {
  return new Promise((resolve) => {
    try {
      const mapEl = document.getElementById('summary-body-map');
      const svgEl = mapEl?.querySelector('svg');
      if (!svgEl) { resolve(null); return; }

      const AMBER = '#e8820c';
      const clone = svgEl.cloneNode(true);

      // Resolve all CSS variables and computed styles into inline attributes
      const origEls = svgEl.querySelectorAll('*');
      const cloneEls = clone.querySelectorAll('*');
      origEls.forEach((origEl, i) => {
        const cloneEl = cloneEls[i];
        if (!cloneEl) return;
        const cs = getComputedStyle(origEl);
        const fill = cs.fill;
        if (fill && fill !== 'none') cloneEl.setAttribute('fill', fill);
        const stroke = cs.stroke;
        if (stroke && stroke !== 'none') cloneEl.setAttribute('stroke', stroke);
        const opacity = origEl.getAttribute('opacity');
        if (opacity) cloneEl.setAttribute('opacity', opacity);
        // Remove any style attributes that might reference CSS vars
        cloneEl.removeAttribute('style');
      });

      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      // Remove any embedded <style> blocks
      clone.querySelectorAll('style').forEach(s => s.remove());
      clone.setAttribute('width', '400');
      clone.setAttribute('height', '400');

      const svgStr = new XMLSerializer().serializeToString(clone);
      const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400; canvas.height = 440;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f7f3ee';
        ctx.fillRect(0, 0, 400, 440);
        ctx.drawImage(img, 0, 0, 400, 400);

        // Draw logo icon (favicon) bottom-left
        const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="24"><circle cx="16" cy="16" r="14" fill="#E8820C" stroke="#2c1a06" stroke-width="1.5"/><path d="M10 22V10M22 22V10M10 16h12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>`;
        const iconUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg);
        const iconImg = new Image();
        iconImg.onload = () => {
          ctx.drawImage(iconImg, 12, 410, 24, 24);
          // Draw "Work" in dark + "str" in amber
          ctx.font = '600 18px "Cormorant Garamond", serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#2c1a06';
          const workW = ctx.measureText('Work').width;
          ctx.fillText('Work', 42, 422);
          ctx.fillStyle = '#e8820c';
          ctx.fillText('str', 42 + workW, 422);
          canvas.toBlob(b => resolve(b), 'image/png');
        };
        iconImg.onerror = () => {
          // Fallback: text only, no icon
          ctx.font = '600 18px "Cormorant Garamond", serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#2c1a06';
          const workW = ctx.measureText('Work').width;
          ctx.fillText('Work', 12, 422);
          ctx.fillStyle = '#e8820c';
          ctx.fillText('str', 12 + workW, 422);
          canvas.toBlob(b => resolve(b), 'image/png');
        };
        iconImg.src = iconUri;
      };
      img.onerror = (e) => { console.error('SVG img load error:', e); resolve(null); };
      img.src = dataUri;
    } catch(e) {
      console.error('Bodymap render error:', e);
      resolve(null);
    }
  });
}

async function confirmCancelSession() {
  if (!_session) { _closeSessionOverlay(); return; }
  if (!confirm('Cancel this session? Logged sets will be discarded.')) return;
  await fetch(`/api/sessions/${_session.id}`,{method:'DELETE'});
  _closeSessionOverlay();
}

function _closeSessionOverlay() {
  clearInterval(_sessionRestTimer);
  clearInterval(_sessionElapsedTimer);
  _releaseWakeLock();
  document.getElementById('session-rest-overlay').classList.remove('show');
  document.getElementById('session-overlay').classList.remove('open');
  document.getElementById('session-elapsed').textContent = '';
  _session = null;
}

// ── Auto-progression engine ───────────────────────────────────────────────────
function _parseRepRange(reps) {
  // "8-12" → {lo:8,hi:12}, "10" → {lo:10,hi:10}
  if (!reps) return {lo: 8, hi: 12};
  const m = String(reps).match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) return {lo: parseInt(m[1]), hi: parseInt(m[2])};
  const n = parseInt(reps);
  return {lo: n||8, hi: n||12};
}

function _calcProgression(lastSets, targetReps, prescribedWeight) {
  // Returns {reps, weight, note} or null when no history
  if (!lastSets || !lastSets.length) return null;
  const {lo, hi} = _parseRepRange(targetReps);
  const weights = lastSets.map(s => s.actual_weight || prescribedWeight || 0).filter(Boolean);
  const reps = lastSets.map(s => s.actual_reps || 0);
  if (!weights.length || !reps.length) return null;
  const baseWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
  // Round to nearest real plate increment: 2.5kg for kg users, 5lb for lb users
  const stepKg = _weightUnit === 'lb' ? 5 / KG_TO_LB : 2.5;
  function _snapWeight(kg) { return Math.round(kg / stepKg) * stepKg; }
  const allHitTop = reps.every(r => r >= hi);
  if (allHitTop) {
    const newWeight = _snapWeight(baseWeight + stepKg);
    const stepDisplay = Math.round(_wDisplay(stepKg) * 10) / 10;
    return {reps: lo, weight: newWeight, note: `+${stepDisplay}${_wLabel()}`};
  }
  const avgReps = Math.round(reps.reduce((a, b) => a + b, 0) / reps.length);
  const sugReps = Math.min(hi, avgReps + 1);
  if (sugReps === avgReps) return null;
  return {reps: sugReps, weight: _snapWeight(baseWeight), note: `+1 rep`};
}

