// ── Statistics ────────────────────────────────────────────────────────────────

async function loadStatistics() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  const empty = document.getElementById('stats-empty');
  const hero = document.getElementById('stats-hero');

  if (!data.total_sessions) {
    empty.style.display = '';
    hero.style.display = 'none';
    document.querySelectorAll('#page-statistics .stats-section').forEach(s => s.style.display = 'none');
    return;
  }
  empty.style.display = 'none';
  hero.style.display = '';
  document.querySelectorAll('#page-statistics .stats-section').forEach(s => s.style.display = '');

  // Hero cards
  document.getElementById('stats-streak').textContent = data.streak;
  const flame = document.getElementById('stats-streak-flame');
  if (data.streak > 0) { flame.classList.add('stats-streak-flame-active'); }
  else { flame.classList.remove('stats-streak-flame-active'); }
  document.getElementById('stats-total-sessions').textContent = data.total_sessions;
  const allVol = data.weekly_volume.reduce((a, w) => a + (w.total_volume || 0), 0);
  const volStr = allVol > 0 ? Math.round(_wDisplay(allVol)).toLocaleString() + ' ' + _wLabel() : '0';
  document.getElementById('stats-total-volume').textContent = volStr;
  _renderVolumeChart(data.weekly_volume);
  _renderMuscleDistribution(data.muscle_distribution);
  _renderPRs(data.personal_records);
  _renderExerciseBreakdown(data.exercise_totals);
}


function _renderVolumeChart(weeklyVolume) {
  const canvas = document.getElementById('stats-volume-chart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = 180;
  ctx.clearRect(0, 0, W, H);

  if (!weeklyVolume.length) {
    ctx.fillStyle = '#c0a880';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No volume data yet', W / 2, H / 2);
    return;
  }

  const maxVol = Math.max(...weeklyVolume.map(w => w.total_volume || 0), 1);
  const barW = Math.min(36, (W - 40) / weeklyVolume.length - 4);
  const gap = 4;
  const totalW = weeklyVolume.length * (barW + gap) - gap;
  const startX = (W - totalW) / 2;
  const chartH = H - 36;

  weeklyVolume.forEach((w, i) => {
    const vol = w.total_volume || 0;
    const barH = Math.max(2, (vol / maxVol) * (chartH - 10));
    const x = startX + i * (barW + gap);
    const y = chartH - barH;

    // Bar
    ctx.fillStyle = '#e8820c';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    const r = Math.min(4, barW / 2);
    ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, chartH); ctx.lineTo(x, chartH);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Week label
    const label = w.week_start ? new Date(w.week_start + 'T00:00:00').toLocaleDateString('en', {month: 'short', day: 'numeric'}) : '';
    ctx.fillStyle = '#b0a090';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barW / 2, H - 4);

    // Volume on top
    if (vol > 0) {
      ctx.fillStyle = '#8a7560';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(Math.round(_wDisplay(vol)).toLocaleString(), x + barW / 2, y - 4);
    }
  });
}

function _renderMuscleDistribution(muscles) {
  // Body map
  const mapEl = document.getElementById('stats-muscle-map');
  if (muscles.length) {
    const maxSets = Math.max(...muscles.map(m => m.set_count));
    const primary = new Set();
    const secondary = new Set();
    muscles.forEach(m => {
      const c = _canonMuscle(m.muscle_group);
      if (!c) return;
      if (m.set_count >= maxSets * 0.4) primary.add(c);
      else secondary.add(c);
    });
    primary.forEach(p => secondary.delete(p));
    _buildWorkoutBodyMap(mapEl, primary, secondary);
  } else {
    mapEl.innerHTML = '';
  }

  // Bar chart
  const listEl = document.getElementById('stats-muscle-list');
  if (!muscles.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No data</div>'; return; }
  const maxSets = Math.max(...muscles.map(m => m.set_count));
  const totalSets = muscles.reduce((a, m) => a + m.set_count, 0);
  listEl.innerHTML = muscles.map(m => {
    const barPct = Math.round((m.set_count / maxSets) * 100);
    const sharePct = Math.round((m.set_count / totalSets) * 100);
    return `<div class="stats-muscle-bar">
      <div class="stats-muscle-bar-name">${esc(m.muscle_group || 'Other')}</div>
      <div class="stats-muscle-bar-track"><div class="stats-muscle-bar-fill" style="width:${barPct}%"></div></div>
      <div class="stats-muscle-bar-val">${m.set_count} sets <span style="color:var(--text-muted)">${sharePct}%</span></div>
    </div>`;
  }).join('');
}

function _renderPRs(prs) {
  const el = document.getElementById('stats-prs');
  if (!prs.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No PRs recorded yet</div>'; return; }
  el.innerHTML = prs.slice(0, 15).map((p, i) => `<div class="stats-pr-row">
    <div class="stats-pr-rank">${i + 1}</div>
    <div class="stats-pr-info">
      <div class="stats-pr-name">${esc(p.exercise_name)}</div>
      <div class="stats-pr-detail">${p.reps} reps @ ${_wFmt(p.weight)} &middot; ${p.date || ''}</div>
    </div>
    <div class="stats-pr-val">${Math.round(_wDisplay(p.best_1rm))} <span style="font-size:11px;font-family:Jost,sans-serif;color:var(--text-muted)">${_wLabel()} 1RM</span></div>
  </div>`).join('');
}

function _renderExerciseBreakdown(exercises) {
  const el = document.getElementById('stats-exercises');
  if (!exercises.length) { el.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">No exercises logged yet</div>'; return; }
  el.innerHTML = exercises.map(ex => {
    const vol = ex.total_volume > 0 ? Math.round(_wDisplay(ex.total_volume)).toLocaleString() + ' ' + _wLabel() : '';
    return `<div class="stats-ex-row" onclick="_openExerciseStats('${ex.exercise_slug}')">
      <div class="stats-ex-info">
        <div class="stats-ex-name">${esc(ex.exercise_name || ex.exercise_slug)}</div>
        <div class="stats-ex-meta">${ex.session_count} session${ex.session_count!==1?'s':''} &middot; ${ex.total_sets} sets${vol ? ' &middot; ' + vol : ''}</div>
      </div>
      <div class="stats-ex-spark" id="spark-${ex.exercise_slug.replace(/[^a-z0-9]/g,'_')}"></div>
    </div>`;
  }).join('');

  // Load sparklines async
  exercises.slice(0, 20).forEach(ex => {
    _loadSparkline(ex.exercise_slug);
  });
}

async function _loadSparkline(slug) {
  const containerId = 'spark-' + slug.replace(/[^a-z0-9]/g, '_');
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const res = await fetch('/api/exercises/' + encodeURIComponent(slug) + '/progress');
    const points = await res.json();
    if (!points.length) return;
    const vals = points.map(p => p.best_1rm || 0).filter(v => v > 0);
    if (vals.length < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 60;
    canvas.style.width = '80px'; canvas.style.height = '30px';
    const ctx = canvas.getContext('2d');
    const min = Math.min(...vals) * 0.9;
    const max = Math.max(...vals) * 1.05;
    const range = max - min || 1;
    const stepX = 156 / (vals.length - 1);
    ctx.strokeStyle = '#e8820c';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = 2 + i * stepX;
      const y = 58 - ((v - min) / range) * 54;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Trend indicator (last vs first)
    if (vals[vals.length-1] > vals[0]) {
      ctx.strokeStyle = 'rgba(232,130,12,0.2)';
      ctx.lineTo(2 + (vals.length-1)*stepX, 58); ctx.lineTo(2, 58); ctx.closePath(); ctx.fillStyle='rgba(232,130,12,0.08)'; ctx.fill();
    }
    container.innerHTML = '';
    container.appendChild(canvas);
  } catch(e) {}
}

async function _openExerciseStats(slug) {
  // Navigate to exercise drawer
  const res = await fetch('/api/exercises/' + encodeURIComponent(slug));
  if (!res.ok) return;
  const ex = await res.json();
  openDrawer(ex);
}

// ── Body Tracking ────────────────────────────────────────────────────────────

async function loadBodyStats() {
  document.getElementById('body-log-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('body-weight-unit-label').textContent = _wLabel();

  const data = await fetch('/api/body?limit=90').then(r => r.json()).catch(() => []);
  const heightCm = parseFloat(localStorage.getItem('_bodyHeightCm') || '0');
  const targetKg = parseFloat(localStorage.getItem('_bodyTargetKg') || '0');

  const empty = document.getElementById('body-empty');
  const listSection = document.getElementById('body-log-list-section');
  const cardsEl = document.getElementById('body-stats-cards');
  const bmiEl = document.getElementById('body-bmi-section');
  const chartEl = document.getElementById('body-chart-section');
  const goalEl = document.getElementById('body-goal-section');

  if (!data.length) {
    empty.style.display = '';
    listSection.style.display = 'none';
    cardsEl.innerHTML = '';
    bmiEl.innerHTML = '';
    chartEl.innerHTML = '';
    goalEl.innerHTML = '';
    _renderBodySetup(heightCm, targetKg);
    return;
  }
  empty.style.display = 'none';

  const sorted = data.slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const latestW = latest.weight_kg;
  const first = sorted[0];

  // 7-day rolling average
  const last7 = sorted.slice(-7);
  const avg7 = last7.reduce((s, e) => s + e.weight_kg, 0) / last7.length;

  // Change from first entry
  const totalChange = latestW - first.weight_kg;
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const lastChange = prev ? latestW - prev.weight_kg : 0;

  // Stat cards
  let cardsHtml = '<div class="stats-hero">';
  cardsHtml += `<div class="stats-hero-card">
    <div class="stats-hero-val">${_wDisplay(latestW).toFixed(1)}</div>
    <div class="stats-hero-label">Current (${_wLabel()})</div>
  </div>`;
  cardsHtml += `<div class="stats-hero-card">
    <div class="stats-hero-val">${_wDisplay(avg7).toFixed(1)}</div>
    <div class="stats-hero-label">7-Day Avg</div>
  </div>`;
  cardsHtml += `<div class="stats-hero-card">
    <div class="stats-hero-val" style="color:${totalChange > 0 ? '#d45050' : totalChange < 0 ? 'var(--sage)' : 'var(--brown-dark)'}">${totalChange > 0 ? '+' : ''}${_wDisplay(totalChange).toFixed(1)}</div>
    <div class="stats-hero-label">Total Change</div>
  </div>`;
  cardsHtml += '</div>';
  cardsEl.innerHTML = cardsHtml;

  // BMI section
  if (heightCm > 0) {
    const heightM = heightCm / 100;
    const bmi = latestW / (heightM * heightM);
    _renderBMI(bmiEl, bmi);
  } else {
    bmiEl.innerHTML = '';
  }

  // Weight trend chart (SVG sparkline)
  _renderBodyChart(chartEl, sorted);

  // Goal progress
  if (targetKg > 0) {
    const startW = first.weight_kg;
    const totalNeeded = targetKg - startW;
    const current = latestW - startW;
    const pct = totalNeeded !== 0 ? Math.min(100, Math.max(0, (current / totalNeeded) * 100)) : 100;
    const remaining = targetKg - latestW;
    goalEl.innerHTML = `<div class="stats-section">
      <div class="stats-section-title">Goal Progress</div>
      <div class="body-goal-bar"><div class="body-goal-fill" style="width:${pct.toFixed(0)}%"></div></div>
      <div class="body-goal-labels">
        <span>${_wDisplay(startW).toFixed(1)} ${_wLabel()}</span>
        <span>${remaining > 0 ? '+' : ''}${_wDisplay(remaining).toFixed(1)} ${_wLabel()} remaining</span>
        <span>${_wDisplay(targetKg).toFixed(1)} ${_wLabel()}</span>
      </div>
    </div>`;
  } else {
    goalEl.innerHTML = '';
  }

  // Setup section (height + target)
  _renderBodySetup(heightCm, targetKg);

  // Log list
  listSection.style.display = '';
  const listEl = document.getElementById('body-log-list');
  listEl.innerHTML = data.slice(0, 30).map(e => {
    const d = new Date(e.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en', {month: 'short', day: 'numeric', year: 'numeric'});
    return `<div class="body-log-row">
      <span class="body-log-date">${dateStr}</span>
      <span class="body-log-val">${_wDisplay(e.weight_kg).toFixed(1)} ${_wLabel()}</span>
      <span class="body-log-note">${esc(e.notes || '')}</span>
      <button class="body-log-del" onclick="deleteBodyLog(${e.id})" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

function _renderBMI(container, bmi) {
  const barMin = 15, barMax = 40;
  const zones = [
    {name: 'Underweight', cls: 'underweight', min: barMin, max: 18.5},
    {name: 'Normal', cls: 'normal', min: 18.5, max: 25},
    {name: 'Overweight', cls: 'overweight', min: 25, max: 30},
    {name: 'Obese', cls: 'obese', min: 30, max: barMax},
  ];
  const totalRange = barMax - barMin;
  const clampedBmi = Math.max(barMin, Math.min(barMax, bmi));
  const pct = ((clampedBmi - barMin) / totalRange) * 100;

  container.innerHTML = `<div class="stats-section">
    <div class="stats-section-title">BMI <span class="stats-section-sub">${bmi.toFixed(1)}</span></div>
    <div class="bmi-zone-bar">
      ${zones.map(z => {
        const w = ((z.max - z.min) / totalRange) * 100;
        return `<div class="bmi-zone ${z.cls}" style="flex:0 0 ${w.toFixed(1)}%">${z.name}</div>`;
      }).join('')}
      <div class="bmi-marker" style="left:${pct.toFixed(1)}%"></div>
    </div>
    <div class="bmi-zone-labels">
      <span>&lt;18.5</span><span>18.5</span><span>25</span><span>30</span><span>40+</span>
    </div>
  </div>`;
}

function _renderBodyChart(container, sorted) {
  if (sorted.length < 2) { container.innerHTML = ''; return; }
  const W = 400, H = 120, pad = 30;
  const vals = sorted.map(e => e.weight_kg);
  const min = Math.min(...vals) * 0.995;
  const max = Math.max(...vals) * 1.005;
  const range = max - min || 1;
  const n = vals.length;

  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (W - pad * 2);
    const y = pad / 2 + (1 - (v - min) / range) * (H - pad);
    return [x.toFixed(1), y.toFixed(1)];
  });

  const polyline = pts.map(p => p.join(',')).join(' ');
  const areaPath = `M${pts[0].join(',')} ${pts.slice(1).map(p => 'L' + p.join(',')).join(' ')} L${pts[n-1][0]},${H - pad/2} L${pts[0][0]},${H - pad/2} Z`;
  const dots = pts.map(([x, y], i) => {
    const d = new Date(sorted[i].date + 'T00:00:00');
    const label = d.toLocaleDateString('en', {month: 'short', day: 'numeric'});
    const wt = _wDisplay(sorted[i].weight_kg).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="3" fill="var(--amber)" stroke="var(--white)" stroke-width="1.5">
      <title>${label}: ${wt} ${_wLabel()}</title>
    </circle>`;
  }).join('');

  // Y-axis labels
  const ySteps = 5;
  let yLabels = '';
  for (let i = 0; i <= ySteps; i++) {
    const v = min + (range * i / ySteps);
    const y = pad / 2 + (1 - i / ySteps) * (H - pad);
    yLabels += `<text x="${pad - 4}" y="${y}" text-anchor="end" font-size="9" fill="#b0a090" dominant-baseline="middle">${_wDisplay(v).toFixed(0)}</text>`;
    yLabels += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#f0ebe0" stroke-width="0.5"/>`;
  }

  // X-axis: first and last date
  const firstDate = new Date(sorted[0].date + 'T00:00:00').toLocaleDateString('en', {month: 'short', day: 'numeric'});
  const lastDate = new Date(sorted[n-1].date + 'T00:00:00').toLocaleDateString('en', {month: 'short', day: 'numeric'});

  container.innerHTML = `<div class="stats-section">
    <div class="stats-section-title">Weight Trend</div>
    <div class="body-chart-wrap">
      <svg viewBox="0 0 ${W} ${H + 16}" height="${H + 16}">
        ${yLabels}
        <path d="${areaPath}" fill="var(--amber)" opacity=".08"/>
        <polyline points="${polyline}" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
        <text x="${pad}" y="${H + 10}" font-size="9" fill="#b0a090">${firstDate}</text>
        <text x="${W - pad}" y="${H + 10}" font-size="9" fill="#b0a090" text-anchor="end">${lastDate}</text>
      </svg>
    </div>
  </div>`;
}

function _renderBodySetup(heightCm, targetKg) {
  const existing = document.getElementById('body-setup-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'body-setup-section';
  section.className = 'stats-section';
  section.innerHTML = `
    <div class="stats-section-title">Settings</div>
    <div class="body-log-form" style="margin-bottom:0">
      <div class="form-group">
        <label>Height (cm)</label>
        <input type="number" id="body-height-input" value="${heightCm || ''}" step="1" min="100" max="250" placeholder="175">
      </div>
      <div class="form-group">
        <label>Target Weight (${_wLabel()})</label>
        <input type="number" id="body-target-input" value="${targetKg ? _wDisplay(targetKg).toFixed(1) : ''}" step="0.1" min="0" placeholder="75.0">
      </div>
      <button onclick="saveBodySettings()">Save</button>
    </div>`;

  const parent = document.getElementById('sub-statistics-body');
  const logList = document.getElementById('body-log-list-section');
  parent.insertBefore(section, logList);
}

async function logBodyWeight() {
  const dateVal = document.getElementById('body-log-date').value;
  const weightInput = parseFloat(document.getElementById('body-log-weight').value);
  const notes = document.getElementById('body-log-notes').value.trim();
  if (!weightInput || isNaN(weightInput)) return;

  const weightKg = _wStore(weightInput);
  await fetch('/api/body', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({date: dateVal, weight_kg: weightKg, notes})
  });
  document.getElementById('body-log-weight').value = '';
  document.getElementById('body-log-notes').value = '';
  loadBodyStats();
}

async function deleteBodyLog(id) {
  await fetch('/api/body/' + id, {method: 'DELETE'});
  loadBodyStats();
}

function saveBodySettings() {
  const heightCm = parseFloat(document.getElementById('body-height-input').value) || 0;
  const targetDisplay = parseFloat(document.getElementById('body-target-input').value) || 0;
  const targetKg = _wStore(targetDisplay);
  localStorage.setItem('_bodyHeightCm', heightCm.toString());
  localStorage.setItem('_bodyTargetKg', targetKg.toString());
  // Also save to server settings for backup
  fetch('/api/settings', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({USER_HEIGHT_CM: heightCm.toString(), BODY_WEIGHT_TARGET_KG: targetKg.toString()})
  });
  loadBodyStats();
}

// Load height/target from server on init
async function _initBodySettings() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    if (s.USER_HEIGHT_CM) localStorage.setItem('_bodyHeightCm', s.USER_HEIGHT_CM);
    if (s.BODY_WEIGHT_TARGET_KG) localStorage.setItem('_bodyTargetKg', s.BODY_WEIGHT_TARGET_KG);
  } catch(e) {}
}
_initBodySettings();

// ── Recovery ─────────────────────────────────────────────────────────────────

let _qwDuration = 45;
let _qwExercises = [];  // currently proposed exercises
let _qwPool = {};       // remaining exercises per muscle group for swapping

function setQwDuration(min, btn) {
  _qwDuration = min;
  document.querySelectorAll('.recovery-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function _recoveryColor(percent, status) {
  if (status === 'untrained') return '#d8cfc4';
  if (percent >= 80) return '#7a9068';
  if (percent >= 50) return '#E8820C';
  return '#e05c5c';
}

function _recoveryStatusClass(status) {
  if (status === 'ready') return 'rc-ready';
  if (status === 'partial') return 'rc-partial';
  if (status === 'recovering') return 'rc-recovering';
  return 'rc-untrained';
}

function _recoveryStatusLabel(status) {
  if (status === 'ready') return 'Ready';
  if (status === 'partial') return 'Partial';
  if (status === 'recovering') return 'Recovering';
  return 'Untrained';
}

function _formatLastTrained(isoStr) {
  if (!isoStr) return 'Never trained';
  const then = new Date(isoStr);
  const diffMs = Date.now() - then.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return 'Less than 1h ago';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const days = Math.floor(diffH / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

async function loadRecovery() {
  const res = await fetch('/api/recovery');
  const data = await res.json();

  const readyCount = data.ready_count || 0;
  const total = data.total_count || 0;
  const pct = data.overall_readiness || 0;
  document.getElementById('recovery-stat-text').textContent =
    `${readyCount} of ${total} muscles ready · ${pct}% overall`;

  // Color body map
  const muscleMap = {};
  (data.muscle_groups || []).forEach(mg => { muscleMap[mg.name] = mg; });
  document.querySelectorAll('[data-muscle]').forEach(el => {
    const mg = muscleMap[el.dataset.muscle];
    el.setAttribute('fill', mg ? _recoveryColor(mg.percent, mg.status) : '#ede7dc');
  });

  // Compact muscle list sorted: recovering first, then partial, ready, untrained
  const statusOrder = { recovering: 0, partial: 1, ready: 2, untrained: 3 };
  const sorted = [...(data.muscle_groups || [])].sort(
    (a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4) || a.percent - b.percent
  );
  document.getElementById('recovery-list').innerHTML = sorted.map(mg => `
    <div class="recovery-list-row">
      <div class="recovery-list-name">${mg.name}</div>
      <div class="recovery-list-bar">
        <div class="recovery-list-bar-fill" style="width:${mg.percent}%;background:${_recoveryColor(mg.percent, mg.status)}"></div>
      </div>
      <div class="recovery-list-right">
        <span class="recovery-list-pct">${mg.percent}%</span>
        <span class="recovery-list-status ${_recoveryStatusClass(mg.status)}">${_recoveryStatusLabel(mg.status)}</span>
      </div>
    </div>
  `).join('');
}

async function generateQuickWorkout() {
  const btn = document.getElementById('qw-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  const res = await fetch('/api/recovery/quick-workout', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({duration_minutes: _qwDuration, min_recovery_percent: 80}),
  });
  const data = await res.json();
  btn.disabled = false;
  btn.textContent = 'Generate from recovered muscles';

  if (!data.exercises?.length) {
    document.getElementById('qw-result').style.display = 'none';
    alert('No recovered muscle groups with exercises yet. Add exercises or finish a workout first.');
    return;
  }

  _qwExercises = data.exercises;
  _qwPool = data.pool || {};
  _renderQwList();
  document.getElementById('qw-meta').textContent =
    `${data.exercises.length} exercises · ~${data.estimated_duration_min} min · ${(data.target_muscle_groups || []).join(', ')}`;
  document.getElementById('qw-result').style.display = '';
}

function _renderQwList() {
  document.getElementById('qw-exercise-list').innerHTML = _qwExercises.map((ex, i) => {
    const hasSwap = (_qwPool[ex.muscle_group] || []).length > 0;
    return `<div class="qw-ex-item" id="qw-ex-${i}">
      <div class="qw-ex-info">
        <div class="qw-ex-name">${esc(ex.name)}</div>
        <div class="qw-ex-meta">${esc(ex.muscle_group)} · ${ex.sets} sets × ${esc(ex.reps)}</div>
      </div>
      <div class="qw-ex-actions">
        ${hasSwap ? `<button class="qw-ex-swap" onclick="swapQwEx(${i})">Swap</button>` : ''}
        <button class="qw-ex-remove" onclick="removeQwEx(${i})">×</button>
      </div>
    </div>`;
  }).join('');
}

function swapQwEx(i) {
  const ex = _qwExercises[i];
  const pool = _qwPool[ex.muscle_group] || [];
  if (!pool.length) return;
  const replacement = pool.shift();
  // put old exercise back into pool
  pool.push(ex);
  _qwPool[ex.muscle_group] = pool;
  _qwExercises[i] = replacement;
  _renderQwList();
}

function removeQwEx(i) {
  _qwExercises.splice(i, 1);
  if (!_qwExercises.length) {
    document.getElementById('qw-result').style.display = 'none';
    return;
  }
  _renderQwList();
}

async function startQuickWorkoutSession() {
  if (!_qwExercises.length) return;
  const muscleGroups = [...new Set(_qwExercises.map(e => e.muscle_group).filter(Boolean))];
  const workoutName = 'Quick — ' + (muscleGroups.length ? muscleGroups.join(', ') : 'Mixed');

  // Create a temporary workout record
  const wRes = await fetch('/api/workouts', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: workoutName, is_temporary: true}),
  });
  const w = await wRes.json();

  // Add exercises to the workout
  for (const ex of _qwExercises) {
    await fetch(`/api/workouts/${w.id}/exercises`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({exercise_slug: ex.slug, sets: ex.sets, reps: ex.reps, rest_sec: ex.rest_sec}),
    });
  }

  // Start session linked to the real workout
  const sRes = await fetch('/api/sessions', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({workout_id: w.id}),
  });
  const s = await sRes.json();
  _session = {
    id: s.id,
    workout_id: w.id,
    workoutName: workoutName,
    isTemporary: true,
    exercises: _qwExercises.map(e => ({
      exercise_slug: e.slug,
      exercise_name: e.name,
      image_url: e.image_url || null,
      muscle_group: e.muscle_group || null,
      sets: e.sets,
      reps: e.reps,
      weight: null,
      rest_sec: e.rest_sec,
    })),
  };
  _sessionExIdx = 0;
  _sessionSetCounts = {};
  _sessionLoggedSets = {};
  _exercisePR = {};
  _sessionPRs = [];
  document.getElementById('qw-result').style.display = 'none';
  _openSessionOverlay();
}

// ── Mesocycle planner ─────────────────────────────────────────────────────────
let _mesoList = [];
let _mesoWorkouts = [];
let _mesoDetailId = null;

async function loadMesocycles() {
  if (!_mesoWorkouts.length) {
    const wr = await fetch('/api/workouts');
    _mesoWorkouts = await wr.json();
  }
  const res = await fetch('/api/mesocycles');
  _mesoList = await res.json();
  _renderMesoList();
}

function _renderMesoList() {
  const el = document.getElementById('meso-list');
  const detail = document.getElementById('meso-detail');
  detail.style.display = 'none';
  el.style.display = '';
  if (!_mesoList.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-muted);padding:20px 0;text-align:center">No training blocks yet. Create your first mesocycle to plan multi-week training.</p>';
    return;
  }
  el.innerHTML = _mesoList.map(m => {
    const start = m.start_date ? new Date(m.start_date) : null;
    const endDate = start ? new Date(start.getTime() + m.weeks * 7 * 86400000) : null;
    const today = new Date();
    let progressPct = 0, weekLabel = '';
    if (start && today >= start) {
      const daysIn = Math.floor((today - start) / 86400000);
      const weekNum = Math.min(m.weeks, Math.floor(daysIn / 7) + 1);
      progressPct = Math.round((weekNum / m.weeks) * 100);
      if (today <= endDate) weekLabel = `Week ${weekNum} of ${m.weeks}`;
      else weekLabel = 'Completed';
    }
    const dateStr = start ? start.toLocaleDateString('en-GB',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `<div class="meso-card" onclick="openMesoDetail(${m.id})">
      <div class="meso-card-header">
        <div class="meso-card-name">${esc(m.name)}</div>
        <div class="meso-card-goal">${esc(m.goal)}</div>
      </div>
      <div class="meso-card-meta">${dateStr} · ${m.weeks} weeks${weekLabel ? ' · <strong>' + esc(weekLabel) + '</strong>' : ''}</div>
      <div class="meso-progress-bar"><div class="meso-progress-fill" style="width:${progressPct}%"></div></div>
      <div class="meso-card-actions" onclick="event.stopPropagation()">
        <button class="btn-outline" style="height:28px;font-size:11px;padding:0 10px" onclick="openMesoModal(${m.id})">Edit</button>
        <button class="btn-outline" style="height:28px;font-size:11px;padding:0 10px;color:#c44;border-color:#c44" onclick="deleteMeso(${m.id})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function openMesoDetail(id) {
  _mesoDetailId = id;
  document.getElementById('meso-list').style.display = 'none';
  const detail = document.getElementById('meso-detail');
  detail.style.display = '';
  detail.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">Loading...</div>';

  const res = await fetch('/api/mesocycles/' + id);
  const m = await res.json();
  if (!_mesoWorkouts.length) {
    const wr = await fetch('/api/workouts');
    _mesoWorkouts = await wr.json();
  }

  const today = new Date();
  const start = m.start_date ? new Date(m.start_date) : null;
  const curWeek = m.current_week;

  const workoutOptions = _mesoWorkouts.map(w =>
    `<option value="${w.id}">${esc(w.name)}</option>`
  ).join('');

  const weekRows = m.weeks_detail.map(w => {
    const isCurrent = w.week_number === curWeek;
    const wids = w.workout_ids || [];
    const wTags = wids.map(wid => {
      const wo = _mesoWorkouts.find(x => x.id === wid);
      return wo ? `<span class="meso-workout-tag active" title="Click to remove" onclick="removeMesoWeekWorkout(${id},${w.week_number},${wid})">${esc(wo.name)}</span>` : '';
    }).join('');
    return `<div class="meso-week-row">
      <div class="meso-week-num ${isCurrent ? 'current' : ''}">W${w.week_number}${isCurrent ? '<div class="meso-week-label">NOW</div>' : ''}</div>
      <div>
        <div class="meso-week-workouts">
          ${wTags}
          <div class="meso-add-workout" onclick="addMesoWeekWorkoutPrompt(${id},${w.week_number})">+ Add</div>
        </div>
        ${w.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${esc(w.notes)}</div>` : ''}
      </div>
      <div class="meso-intensity" title="Click to change intensity" onclick="setMesoWeekIntensity(${id},${w.week_number},${w.intensity_pct})">${w.intensity_pct}%</div>
    </div>`;
  }).join('');

  detail.innerHTML = `
    <div class="meso-detail-back" onclick="_renderMesoList()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      All Blocks
    </div>
    <div class="meso-detail-title">${esc(m.name)}</div>
    <div class="meso-detail-sub">${esc(m.goal)} · ${m.weeks} weeks from ${m.start_date}</div>
    <div id="meso-week-list">${weekRows}</div>`;
}

async function addMesoWeekWorkoutPrompt(mesoId, weekNum) {
  if (!_mesoWorkouts.length) return;
  const workoutNames = _mesoWorkouts.map((w, i) => `${i+1}. ${w.name}`).join('\n');
  const choice = prompt(`Choose a workout to add to Week ${weekNum}:\n\n${workoutNames}\n\nEnter number:`);
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= _mesoWorkouts.length) return;
  const workoutId = _mesoWorkouts[idx].id;

  const m = await fetch('/api/mesocycles/' + mesoId).then(r => r.json());
  const weekData = m.weeks_detail.find(w => w.week_number === weekNum) || {};
  const ids = weekData.workout_ids || [];
  if (ids.includes(workoutId)) return;
  ids.push(workoutId);
  await fetch(`/api/mesocycles/${mesoId}/weeks/${weekNum}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({workout_ids: ids, intensity_pct: weekData.intensity_pct||100, notes: weekData.notes||null}),
  });
  openMesoDetail(mesoId);
}

async function removeMesoWeekWorkout(mesoId, weekNum, workoutId) {
  const m = await fetch('/api/mesocycles/' + mesoId).then(r => r.json());
  const weekData = m.weeks_detail.find(w => w.week_number === weekNum) || {};
  const ids = (weekData.workout_ids || []).filter(id => id !== workoutId);
  await fetch(`/api/mesocycles/${mesoId}/weeks/${weekNum}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({workout_ids: ids, intensity_pct: weekData.intensity_pct||100, notes: weekData.notes||null}),
  });
  openMesoDetail(mesoId);
}

async function setMesoWeekIntensity(mesoId, weekNum, current) {
  const val = prompt(`Week ${weekNum} intensity % (current: ${current}):`);
  const pct = parseInt(val);
  if (isNaN(pct) || pct < 1 || pct > 200) return;
  const m = await fetch('/api/mesocycles/' + mesoId).then(r => r.json());
  const weekData = m.weeks_detail.find(w => w.week_number === weekNum) || {};
  await fetch(`/api/mesocycles/${mesoId}/weeks/${weekNum}`, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({workout_ids: weekData.workout_ids||[], intensity_pct: pct, notes: weekData.notes||null}),
  });
  openMesoDetail(mesoId);
}

function openMesoModal(id = null) {
  document.getElementById('meso-id').value = id || '';
  document.getElementById('meso-modal-title').textContent = id ? 'Edit Training Block' : 'New Training Block';
  if (id) {
    const m = _mesoList.find(x => x.id === id);
    if (m) {
      document.getElementById('meso-name').value = m.name;
      document.getElementById('meso-goal').value = m.goal;
      document.getElementById('meso-start-date').value = m.start_date;
      document.getElementById('meso-weeks').value = m.weeks;
      document.getElementById('meso-notes').value = m.notes || '';
    }
  } else {
    document.getElementById('meso-name').value = '';
    document.getElementById('meso-goal').value = 'hypertrophy';
    document.getElementById('meso-start-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('meso-weeks').value = 4;
    document.getElementById('meso-notes').value = '';
  }
  document.getElementById('meso-modal').classList.add('open');
}

function closeMesoModal() { document.getElementById('meso-modal').classList.remove('open'); }

async function saveMesocycle() {
  const id = document.getElementById('meso-id').value;
  const payload = {
    name: document.getElementById('meso-name').value.trim(),
    goal: document.getElementById('meso-goal').value,
    start_date: document.getElementById('meso-start-date').value,
    weeks: parseInt(document.getElementById('meso-weeks').value) || 4,
    notes: document.getElementById('meso-notes').value.trim() || null,
  };
  if (!payload.name) return;
  if (id) {
    await fetch('/api/mesocycles/'+id, {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  } else {
    await fetch('/api/mesocycles', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
  }
  closeMesoModal();
  loadMesocycles();
}

async function deleteMeso(id) {
  if (!confirm('Delete this training block?')) return;
  await fetch('/api/mesocycles/'+id, {method:'DELETE'});
  loadMesocycles();
}

