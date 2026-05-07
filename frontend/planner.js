// ── Planner ───────────────────────────────────────────────────────────────────
let plannerWeekStart = getMonday(new Date());
const SLOTS = ['Morning', 'Afternoon', 'Evening'];

function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0,0,0,0);
  return dt;
}

function plannerPrevWeek() { plannerWeekStart.setDate(plannerWeekStart.getDate()-7); loadPlanner(); }
function plannerNextWeek() { plannerWeekStart.setDate(plannerWeekStart.getDate()+7); loadPlanner(); }
function plannerGoToday() { plannerWeekStart = getMonday(new Date()); loadPlanner(); }

async function loadPlanner() {
  const iso = plannerWeekStart.toISOString().slice(0,10);
  const endDate = new Date(plannerWeekStart);
  endDate.setDate(endDate.getDate()+6);

  const label = document.getElementById('planner-week-label');
  label.textContent = `${plannerWeekStart.toLocaleDateString('en',{month:'short',day:'numeric'})} – ${endDate.toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'})}`;

  const res = await fetch('/api/plan?week=' + iso);
  const planEntries = await res.json();

  const today = new Date(); today.setHours(0,0,0,0);
  const grid = document.getElementById('planner-grid');
  const days = [];
  for (let i=0; i<7; i++) {
    const d = new Date(plannerWeekStart);
    d.setDate(d.getDate()+i);
    days.push(d);
  }

  const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  grid.innerHTML = days.map((d, di) => {
    const iso_d = d.toISOString().slice(0,10);
    const isToday = d.getTime() === today.getTime();
    const slots = SLOTS.map(slot => {
      const entry = planEntries.find(e => e.date === iso_d && e.slot === slot);
      if (entry) {
        return `<div class="planner-slot">
          <div class="slot-label">${slot}</div>
          <div class="slot-filled">
            <div class="slot-exercise-name">${esc(entry.exercise_slug || 'Template')}</div>
            <div class="slot-exercise-meta">${entry.notes ? esc(entry.notes) : ''}</div>
            <div class="slot-actions">
              <button class="slot-btn danger" onclick="removePlanEntry(${entry.id})">x</button>
            </div>
          </div>
        </div>`;
      }
      return `<div class="planner-slot">
        <div class="slot-label">${slot}</div>
        <div class="slot-empty" onclick="openExercisePicker('${iso_d}','${slot}')">+</div>
      </div>`;
    }).join('');
    return `<div class="planner-day ${isToday ? 'today' : ''}">
      <div class="planner-day-header">
        <div class="planner-day-name">${DAY_NAMES[di]}</div>
        <div class="planner-day-num">${d.getDate()}</div>
      </div>
      ${slots}
    </div>`;
  }).join('');

  loadTemplates();
}

async function removePlanEntry(id) {
  await fetch('/api/plan/'+id, {method:'DELETE'});
  loadPlanner();
}

// ── Exercise picker for planner ───────────────────────────────────────────────
let _pickerDate = '', _pickerSlot = '', _pickerMode = 'planner';


function filterPickerItems(q) {
  const ql = q.toLowerCase();
  document.querySelectorAll('.picker-item').forEach(item => {
    const matchText = !ql || item.textContent.toLowerCase().includes(ql);
    const matchMuscle = !_pickerMuscle || item.dataset.muscle === _pickerMuscle;
    item.style.display = matchText && matchMuscle ? '' : 'none';
  });
}

async function pickExercise(slug, name, dataset) {
  if (_pickerMode === 'wb') {
    addWbExercise(slug, name || slug, {
      sets: parseInt(dataset?.sets) || 3,
      reps: dataset?.reps || '8-12',
      rest_sec: parseInt(dataset?.rest) || 90,
      image_url: dataset?.img || '',
    });
    closePicker();
    return;
  }
  await fetch('/api/plan', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({date:_pickerDate, slot:_pickerSlot, exercise_slug:slug}),
  });
  closePicker();
  loadPlanner();
}

function closePicker() {
  document.getElementById('picker-modal').classList.remove('open');
  _pickerMuscle = '';
  if (_pickerMode === 'wb') {
    _pickerMode = 'planner';
    document.querySelector('.picker-tabs').style.display = '';
    document.getElementById('picker-modal').querySelector('.modal-title').textContent = 'Add to Plan';
  }
}

function openWbExercisePicker() {
  _pickerMode = 'wb';
  _pickerTab = 'exercise';
  document.querySelector('.picker-tabs').style.display = 'none';
  document.getElementById('picker-modal').querySelector('.modal-title').textContent = 'Add Exercise';
  document.getElementById('picker-modal').classList.add('open');
  renderPickerContent();
}


// ── Planner picker (with workout tab) ─────────────────────────────────────────
let _pickerTab = 'workout';

function switchPickerTab(tab) {
  _pickerTab = tab;
  document.querySelectorAll('.picker-tab').forEach((t,i) => t.classList.toggle('active', ['workout','exercise'][i] === tab));
  renderPickerContent();
}

async function renderPickerContent() {
  const container = document.getElementById('picker-modal-content');
  if (_pickerTab === 'workout') {
    const res = await fetch('/api/workouts');
    const list = await res.json();
    if (!list.length) {
      container.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">No workouts yet. Create one in the Workouts tab.</p>';
      return;
    }
    container.innerHTML = list.map(w =>
      `<div class="picker-item" onclick="pickWorkout(${w.id},'${esc(w.name)}')">
        ${esc(w.name)}<div class="meta">${w.exercise_count||0} exercises</div>
      </div>`).join('');
  } else {
    const [exRes, recentExs] = await Promise.all([
      fetch('/api/exercises?per_page=500').then(r => r.json()),
      fetch('/api/exercises/recent?limit=6').then(r => r.json()).catch(() => []),
    ]);
    const exercises = exRes.exercises || [];

    const _quickItem = (e) => {
      const img = e.image_url
        ? `<img class="picker-quick-img" src="${esc(e.image_url)}" alt="" loading="lazy">`
        : `<div class="picker-quick-noimg"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12"/></svg></div>`;
      return `<div class="picker-quick-item" data-slug="${e.slug}" data-name="${esc(e.name)}" data-muscle="${esc(e.muscle_group||'')}" data-sets="${e.default_sets||3}" data-reps="${esc(e.default_reps||'8-12')}" data-rest="${e.default_rest_sec||90}" data-img="${esc(e.image_url||'')}" onclick="pickExercise(this.dataset.slug,this.dataset.name,this.dataset)">
        ${img}<div class="picker-quick-name">${esc(e.name)}</div>
      </div>`;
    };

    const quickHtml = [
      recentExs.length ? `<div class="picker-quick-label">Recent</div><div class="picker-quick-row">${recentExs.map(_quickItem).join('')}</div>` : '',
    ].join('');

    const muscles = [...new Set(exercises.map(e => e.muscle_group).filter(Boolean))].sort();
    container.innerHTML = `
      ${quickHtml}
      <input type="text" class="filter-select" placeholder="Search exercises..." style="width:100%;margin-bottom:8px" oninput="filterPickerItems(this.value)" id="picker-search">
      <div class="picker-chips" id="picker-chips">
        ${muscles.map(m => `<div class="picker-chip${_pickerMuscle===m?' active':''}" data-muscle="${esc(m)}" onclick="setPickerMuscle('${esc(m)}')">${esc(m)}</div>`).join('')}
      </div>
      <div class="picker-modal-grid" id="picker-grid">
        ${exercises.map(e => {
          const img = e.image_url ? `<img class="picker-item-img" src="${esc(e.image_url)}" alt="" loading="lazy">` : '';
          return `<div class="picker-item" data-slug="${e.slug}" data-name="${esc(e.name)}" data-muscle="${esc(e.muscle_group||'')}" data-sets="${e.default_sets||3}" data-reps="${esc(e.default_reps||'8-12')}" data-rest="${e.default_rest_sec||90}" data-img="${esc(e.image_url||'')}" onclick="pickExercise(this.dataset.slug,this.dataset.name,this.dataset)">
            ${img}${esc(e.name)}<div class="meta">${esc(e.muscle_group||'')}</div>
          </div>`;
        }).join('')}
      </div>`;
  }
}

function setPickerMuscle(m) {
  _pickerMuscle = _pickerMuscle === m ? '' : m;
  document.querySelectorAll('.picker-chip').forEach(c => c.classList.toggle('active', c.dataset.muscle === _pickerMuscle));
  filterPickerItems(document.getElementById('picker-search')?.value || '');
}

async function openExercisePicker(date, slot) {
  _pickerDate = date; _pickerSlot = slot;
  _pickerTab = 'workout';
  document.querySelectorAll('.picker-tab').forEach((t,i) => t.classList.toggle('active', i===0));
  document.getElementById('picker-modal').classList.add('open');
  renderPickerContent();
}

async function pickWorkout(workoutId, name) {
  await fetch('/api/plan',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({date:_pickerDate,slot:_pickerSlot,workout_id:workoutId,notes:name}),
  });
  closePicker();
  loadPlanner();
}

// ── History (sessions) ────────────────────────────────────────────────────────
async function loadHistory() {
  const res = await fetch('/api/sessions?limit=50');
  const sessions = await res.json();
  const container = document.getElementById('history-content');
  const empty = document.getElementById('history-empty');

  if (!sessions.length) { container.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  container.innerHTML = sessions.map(s => {
    const startDate = new Date(s.started_at);
    const duration = s.finished_at
      ? Math.round((new Date(s.finished_at) - startDate) / 60000) + ' min'
      : '';
    const vol = s.total_volume > 0 ? `${Math.round(_wDisplay(s.total_volume))} ${_wLabel()}` : '';
    return `<div class="session-history-card" onclick="openSessionDetail(${s.id})">
      <div class="session-history-name">${esc(s.workout_name||'Quick Session')}</div>
      <div class="session-history-meta">
        <span>${startDate.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'})}</span>
        ${duration ? `<span>${duration}</span>` : ''}
        ${s.exercise_count ? `<span>${s.exercise_count} exercise${s.exercise_count!==1?'s':''}</span>` : ''}
        ${vol ? `<span>${vol} volume</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function openSessionDetail(sid) {
  const res = await fetch('/api/sessions/' + sid);
  const s = await res.json();

  // Group sets by exercise
  const byEx = {};
  (s.sets||[]).forEach(set => {
    if (!byEx[set.exercise_slug]) byEx[set.exercise_slug] = [];
    byEx[set.exercise_slug].push(set);
  });

  const rows = Object.entries(byEx).map(([slug, sets]) => {
    const name = sets[0].exercise_name || slug;
    const pills = sets.map(s =>
      `<span class="set-pill">${s.actual_reps||'?'} reps${s.actual_weight ? ' @ '+_wFmt(s.actual_weight) : ''}</span>`
    ).join('');
    return `<div class="history-exercise-row">
      <div class="history-exercise-info">
        <div class="history-exercise-name">${esc(name)}</div>
        <div class="log-entry-sets">${pills||'<span style="font-size:11px;color:var(--text-muted)">No sets logged</span>'}</div>
      </div>
    </div>`;
  }).join('');

  const startDate = new Date(s.started_at);
  document.getElementById('drawer-content').innerHTML = `
    <div class="drawer-body">
      <div class="drawer-title">${esc(s.workout_name||'Quick Session')}</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">${startDate.toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
      <div class="drawer-section">Exercises</div>
      ${rows || '<p style="font-size:13px;color:var(--text-muted)">No data logged.</p>'}
      <button class="btn-danger" style="width:100%;margin-top:24px" onclick="deleteSession(${s.id})">Delete Session</button>
    </div>`;
  document.getElementById('drawer-overlay').classList.add('open');
}

async function deleteSession(sid) {
  if (!confirm('Delete this session? All logged sets will be permanently removed.')) return;
  await fetch('/api/sessions/' + sid, {method: 'DELETE'});
  closeDrawer();
  loadHistory();
}

