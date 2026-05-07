// ── Add Exercise modal ────────────────────────────────────────────────────────
function openAddModal() {
  showAddPicker();
  document.getElementById('add-modal').classList.add('open');
}
function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
  clearCamera();
}
function showAddPicker() {
  document.getElementById('add-modal-title').textContent = 'Add Exercise';
  document.getElementById('add-modal-picker').style.display = '';
  document.getElementById('add-modal-image').style.display = 'none';
}
function showAddImage() {
  document.getElementById('add-modal-title').textContent = 'From Image';
  document.getElementById('add-modal-picker').style.display = 'none';
  document.getElementById('add-modal-image').style.display = '';
}


// ── AI Generate ───────────────────────────────────────────────────────────────
function clearGenerateForm() {
  const prompt = document.getElementById('gen-prompt');
  if (prompt) prompt.value = '';
  ['gen-category','gen-difficulty','gen-muscle','gen-equipment'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const result = document.getElementById('gen-result');
  if (result) result.innerHTML = '';
}

async function loadAiStatus() {
  const bar = document.getElementById('ai-status-bar');
  bar.innerHTML = '<div class="ai-status unknown">Checking AI connection...</div>';
  const res = await fetch('/api/ai/test');
  const data = await res.json();
  if (data.ok) {
    bar.innerHTML = `<div class="ai-status ok">AI connected — ${esc(data.model)}</div>`;
  } else {
    bar.innerHTML = `<div class="ai-status err">AI not configured — <a onclick="switchTab('settings')" style="cursor:pointer;text-decoration:underline">add API key in Settings</a></div>`;
  }
}

async function generateExercise() {
  const prompt = document.getElementById('gen-prompt').value.trim();
  const category = document.getElementById('gen-category').value;
  const difficulty = document.getElementById('gen-difficulty').value;
  const muscle = document.getElementById('gen-muscle').value;
  const equip = document.getElementById('gen-equipment').value;

  let fullPrompt = prompt || 'Create an exercise';
  if (category) fullPrompt += `. Category: ${category}`;
  if (difficulty) fullPrompt += `. Difficulty: ${difficulty}`;
  if (muscle) fullPrompt += `. Target muscle: ${muscle}`;
  if (equip) fullPrompt += `. Equipment: ${equip}`;

  const result = document.getElementById('gen-result');
  const btn = document.getElementById('gen-btn');
  btn.disabled = true;
  result.innerHTML = `<div class="gen-loading"><div class="spinner"></div>Generating exercise and photo...</div>`;

  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({prompt: fullPrompt}),
  });
  const data = await res.json();
  btn.disabled = false;

  if (data.error) {
    result.innerHTML = `<div style="color:#c44;font-size:13px;margin-top:12px">${esc(data.error)}</div>`;
    return;
  }

  const imgUrl = data.image ? '/' + data.image : null;
  const muscles = (data.muscles||[]).map(m=>`<span class="tag-pill">${esc(m)}</span>`).join('');
  const equips = (data.equipment||[]).map(e=>`<span class="tag-pill">${esc(e)}</span>`).join('');

  result.innerHTML = `<div class="gen-result">
    ${imgUrl ? `<img class="gen-result-img" src="${imgUrl}" alt="">` : ''}
    <div class="gen-result-body">
      <div style="font-family:'Cormorant Garamond',serif;font-weight:700;font-size:20px;margin-bottom:6px">${esc(data.name)}</div>
      ${data.description ? `<p style="font-size:13px;color:var(--text-mid);margin-bottom:10px">${esc(data.description)}</p>` : ''}
      ${muscles ? `<div class="tag-row" style="margin-bottom:8px">${muscles}</div>` : ''}
      ${equips ? `<div class="tag-row" style="margin-bottom:12px">${equips}</div>` : ''}
      <div style="display:flex;gap:8px">
        <button class="btn-sage" onclick="approveExercise('${data.slug}');document.getElementById('gen-result').innerHTML='<div style=&quot;color:var(--sage);font-size:13px;padding:12px&quot;>Approved and added to library.</div>'">Approve</button>
        <button class="btn-outline" onclick="generateExercise()">Regenerate</button>
        <button class="btn-danger" onclick="trashExercise('${data.slug}');document.getElementById('gen-result').innerHTML=''">Discard</button>
      </div>
    </div>
  </div>`;

  refreshCounts();
}

// ── Import tabs ───────────────────────────────────────────────────────────────
// ── Seed browser ──────────────────────────────────────────────────────────────
async function loadSeedFilters() {
  const res = await fetch('/api/seed/filters');
  if (!res.ok) return;
  const data = await res.json();

  const catSel = document.getElementById('seed-category');
  data.categories.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  const musSel = document.getElementById('seed-muscle');
  data.muscles.forEach(m => {
    const o = document.createElement('option'); o.value = m; o.textContent = m;
    musSel.appendChild(o);
  });

  const eqSel = document.getElementById('seed-equipment');
  data.equipment.forEach(e => {
    const o = document.createElement('option'); o.value = e; o.textContent = e;
    eqSel.appendChild(o);
  });

  loadSeed();
}

let seedFiltersLoaded = false;
async function loadSeed() {
  seedOffset = 0;
  const q = document.getElementById('seed-q')?.value || '';
  const category = document.getElementById('seed-category')?.value || '';
  const muscle = document.getElementById('seed-muscle')?.value || '';
  const equip = document.getElementById('seed-equipment')?.value || '';
  const level = document.getElementById('seed-level')?.value || '';

  const status = document.getElementById('seed-status');
  if (status) status.textContent = 'Loading...';

  const params = new URLSearchParams({q, category, muscle, equipment: equip, level, limit: 60, offset: 0});
  const res = await fetch('/api/seed/browse?' + params);

  if (!res.ok) {
    if (status) status.textContent = 'Failed to load exercise database.';
    return;
  }

  const data = await res.json();
  const exercises = data.results;
  seedTotal = data.total;
  seedOffset = exercises.length;

  if (status) {
    if (seedOffset < seedTotal) status.textContent = `Showing ${seedOffset} of ${seedTotal} exercises`;
    else status.textContent = `${seedTotal} exercises found`;
  }

  const grid = document.getElementById('seed-grid');
  if (!exercises.length) {
    grid.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:20px 0">No exercises found. Try different filters.</p>';
    document.getElementById('seed-load-more').style.display = 'none';
    return;
  }

  grid.innerHTML = exercises.map(ex => seedCardHTML(ex)).join('');
  document.getElementById('seed-load-more').style.display = seedOffset < seedTotal ? 'block' : 'none';
}

async function loadMoreSeed() {
  const q = document.getElementById('seed-q')?.value || '';
  const category = document.getElementById('seed-category')?.value || '';
  const muscle = document.getElementById('seed-muscle')?.value || '';
  const equip = document.getElementById('seed-equipment')?.value || '';
  const level = document.getElementById('seed-level')?.value || '';

  const btn = document.querySelector('#seed-load-more button');
  if (btn) btn.disabled = true;

  const params = new URLSearchParams({q, category, muscle, equipment: equip, level, limit: 60, offset: seedOffset});
  const res = await fetch('/api/seed/browse?' + params);
  if (btn) btn.disabled = false;

  if (!res.ok) return;

  const data = await res.json();
  const exercises = data.results;
  seedOffset += exercises.length;

  const grid = document.getElementById('seed-grid');
  grid.insertAdjacentHTML('beforeend', exercises.map(ex => seedCardHTML(ex)).join(''));

  const status = document.getElementById('seed-status');
  if (status) {
    if (seedOffset < seedTotal) status.textContent = `Showing ${seedOffset} of ${seedTotal} exercises`;
    else status.textContent = `${seedTotal} exercises found`;
  }

  document.getElementById('seed-load-more').style.display = seedOffset < seedTotal ? 'block' : 'none';
}

function seedCardHTML(ex) {
  const img = ex.image
    ? `<img src="${esc(ex.image)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\'display:flex;align-items:center;justify-content:center;height:100%\'><svg width=\'32\' height=\'32\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.5\' stroke-linecap=\'round\'><path d=\'M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4\'/></svg></div>'">`
    : `<div style="display:flex;align-items:center;justify-content:center;height:100%"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12M2 8h4M18 8h4M2 16h4M18 16h4"/></svg></div>`;
  const sel = seedSelected.has(ex.seed_id) ? 'selected' : '';
  return `<div class="seed-card ${sel}" id="seed-${esc(ex.seed_id)}" onclick="toggleSeedSelect('${esc(ex.seed_id)}', '${esc(ex.name)}')">
    <div class="seed-card-img">${img}</div>
    <div class="seed-card-body">
      <div class="seed-card-name">${esc(ex.name)}</div>
      <div class="seed-card-meta">${esc(ex.muscle_group||'')} ${ex.difficulty ? '· ' + esc(ex.difficulty) : ''}</div>
    </div>
  </div>`;
}

function debounceSeedSearch() {
  clearTimeout(seedDebounceTimer);
  seedDebounceTimer = setTimeout(loadSeed, 400);
}

function toggleSeedSelect(seedId, name) {
  if (seedSelected.has(seedId)) {
    seedSelected.delete(seedId);
  } else {
    seedSelected.add(seedId);
  }
  const card = document.getElementById('seed-' + seedId);
  if (card) card.classList.toggle('selected', seedSelected.has(seedId));
  updateSeedBar();
}

function updateSeedBar() {
  const bar = document.getElementById('seed-import-bar');
  const cnt = document.getElementById('seed-selected-count');
  if (seedSelected.size > 0) {
    bar.style.display = 'flex';
    cnt.textContent = `${seedSelected.size} exercise${seedSelected.size !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function clearSeedSelection() {
  seedSelected.clear();
  document.querySelectorAll('.seed-card.selected').forEach(c => c.classList.remove('selected'));
  updateSeedBar();
}

async function importSelected() {
  const ids = [...seedSelected];
  const status = document.getElementById('seed-status');
  status.textContent = `Importing ${ids.length} exercise${ids.length !== 1 ? 's' : ''}...`;
  let imported = 0;
  for (const seed_id of ids) {
    const res = await fetch('/api/seed/import', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({seed_id}),
    });
    if (res.ok) imported++;
  }
  status.textContent = `${imported} exercise${imported !== 1 ? 's' : ''} sent to Staging.`;
  clearSeedSelection();
  refreshCounts();
}

// ── Camera import ─────────────────────────────────────────────────────────────
function onDragOver(e) { e.preventDefault(); document.getElementById('upload-zone').classList.add('dragover'); }
function onDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('dragover');
  addCameraFiles([...e.dataTransfer.files]);
}
function onCameraFiles(e) { addCameraFiles([...e.target.files]); }

function addCameraFiles(files) {
  files.slice(0, 8 - cameraFiles.length).forEach(f => {
    if (f.type.startsWith('image/')) cameraFiles.push(f);
  });
  renderThumbs();
}

function renderThumbs() {
  const strip = document.getElementById('thumb-strip');
  const submit = document.getElementById('camera-submit');
  const clear = document.getElementById('camera-clear');
  strip.innerHTML = cameraFiles.map((f, i) => {
    const url = URL.createObjectURL(f);
    return `<div class="thumb"><img src="${url}" alt=""><span class="thumb-remove" onclick="removeCameraFile(${i})">x</span></div>`;
  }).join('');
  submit.style.display = cameraFiles.length ? '' : 'none';
  clear.style.display = cameraFiles.length ? '' : 'none';
}

function removeCameraFile(i) { cameraFiles.splice(i, 1); renderThumbs(); }
function clearCamera() { cameraFiles = []; renderThumbs(); document.getElementById('camera-result').innerHTML = ''; document.getElementById('camera-input').value = ''; }

async function submitCamera() {
  if (!cameraFiles.length) return;
  const result = document.getElementById('camera-result');
  const btn = document.getElementById('camera-submit');
  btn.disabled = true;
  result.innerHTML = '<div class="gen-loading"><div class="spinner"></div>Analysing image with AI...</div>';

  const form = new FormData();
  cameraFiles.forEach(f => form.append('images', f));

  const res = await fetch('/api/import/camera', {method:'POST', body:form});
  const data = await res.json();
  btn.disabled = false;

  if (data.error) {
    result.innerHTML = `<div style="color:#c44;font-size:13px">${esc(data.error)}</div>`;
    return;
  }

  result.innerHTML = `<div style="background:var(--cream);border:1px solid var(--border-soft);border-radius:10px;padding:14px">
    <div style="font-family:'Cormorant Garamond',serif;font-weight:700;font-size:18px;margin-bottom:6px">${esc(data.name)}</div>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Sent to Staging for review.</p>
    <button class="btn-sage" onclick="closeAddModal();switchTab('exercises');switchSubTab('exercises','staging')">View in Staging</button>
  </div>`;
  refreshCounts();
  cameraFiles = []; renderThumbs(); document.getElementById('camera-input').value = '';
}

