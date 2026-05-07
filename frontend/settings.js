// ── Counts / badges ────────────────────────────────────────────────────────────
async function refreshCounts() {
  const r = await fetch('/api/exercises/counts');
  const c = await r.json();
  const badge = document.getElementById('staging-badge');
  const tabBadge = document.getElementById('staging-tab-badge');
  if (c.staged > 0) {
    badge.textContent = c.staged;
    badge.classList.add('visible');
    if (tabBadge) { tabBadge.textContent = c.staged; tabBadge.style.display = ''; }
  } else {
    badge.classList.remove('visible');
    if (tabBadge) tabBadge.style.display = 'none';
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  document.getElementById('set-ppq-key').value = s.PPQ_API_KEY||'';
  document.getElementById('set-ppq-credit-id').value = s.PPQ_CREDIT_ID||'';
  document.getElementById('set-ppq-url').value = s.PPQ_BASE_URL||'';
  document.getElementById('set-ppq-model').value = s.PPQ_MODEL||'';
  document.getElementById('set-ppq-img-model').value = s.PPQ_IMAGE_MODEL||'';
  document.getElementById('set-ppq-vis-model').value = s.PPQ_VISION_MODEL||'';
  document.getElementById('set-equipment').value = s.EQUIPMENT||'';
  document.getElementById('set-weight-unit').value = s.WEIGHT_UNIT||'kg';
  _weightUnit = s.WEIGHT_UNIT || 'kg';
  _setAiStatusBadge(s.PPQ_API_KEY ? 'unchecked' : 'none');
  if (s.PPQ_CREDIT_ID) _fetchBalance();

  fetch('/api/version').then(r => r.json()).then(d => {
    const el = document.getElementById('version-label');
    if (el) el.textContent = 'Liftme ' + (d.version||'dev');
  }).catch(() => {});
}

function toggleSecret(fieldId, btn) {
  const input = document.getElementById(fieldId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.querySelector('svg').innerHTML = showing
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
}

function _setAiStatusBadge(state, model) {
  const badge = document.getElementById('ai-status-badge');
  if (state === 'none') {
    badge.style.display = 'inline-block';
    badge.textContent = 'No key set';
    badge.style.background = '#fde8e8'; badge.style.color = '#c05040';
  } else if (state === 'ok') {
    badge.style.display = 'inline-block';
    badge.textContent = 'Connected' + (model ? ' \u00b7 ' + model : '');
    badge.style.background = '#e8f5e9'; badge.style.color = '#3a6a40';
  } else if (state === 'err') {
    badge.style.display = 'inline-block';
    badge.textContent = 'Connection failed';
    badge.style.background = '#fde8e8'; badge.style.color = '#c05040';
  } else {
    badge.style.display = 'inline-block';
    badge.textContent = 'Key saved';
    badge.style.background = '#fff4e0'; badge.style.color = '#9a6010';
  }
}

async function _fetchBalance() {
  const el = document.getElementById('ai-balance');
  const topupBtn = document.getElementById('topup-btn');
  try {
    const r = await fetch('/api/ai/balance').then(r=>r.json());
    if (r.ok) {
      el.textContent = 'Balance: $' + r.balance.toFixed(2);
      el.style.display = '';
      el.style.color = r.balance < 1 ? '#c05040' : 'var(--text-mid)';
      if (topupBtn) topupBtn.style.display = '';
    } else { el.style.display = 'none'; if (topupBtn) topupBtn.style.display = 'none'; }
  } catch { el.style.display = 'none'; if (topupBtn) topupBtn.style.display = 'none'; }
}

async function testAiConnection() {
  const btn = document.getElementById('ai-test-btn');
  btn.disabled = true; btn.textContent = 'Testing...';
  try {
    const r = await fetch('/api/ai/test').then(r=>r.json());
    const modelLabel = r.ok ? r.model + ' \u00b7 ' + r.image_model + ' \u00b7 ' + r.vision_model : '';
    _setAiStatusBadge(r.ok ? 'ok' : 'err', modelLabel);
  } catch {
    _setAiStatusBadge('err');
  }
  btn.disabled = false; btn.textContent = 'Test Connection';
}

let _topupState = { invoiceId: null, pollTimer: null, countdownTimer: null };

function openTopup() {
  _topupState = { invoiceId: null, pollTimer: null, countdownTimer: null };
  document.getElementById('topup-step1').style.display = '';
  document.getElementById('topup-step2').style.display = 'none';
  document.getElementById('topup-amount').value = '';
  document.getElementById('topup-err').style.display = 'none';
  document.getElementById('topup-overlay').style.display = 'block';
  document.getElementById('topup-modal-wrap').style.display = 'flex';
}

function closeTopup() {
  document.getElementById('topup-overlay').style.display = 'none';
  document.getElementById('topup-modal-wrap').style.display = 'none';
  document.getElementById('topup-iframe').src = '';
  if (_topupState.pollTimer) clearInterval(_topupState.pollTimer);
  if (_topupState.countdownTimer) clearInterval(_topupState.countdownTimer);
}

function _topupAmount(val) {
  document.getElementById('topup-amount').value = val;
}

async function createTopup() {
  const amount = parseFloat(document.getElementById('topup-amount').value);
  const errEl = document.getElementById('topup-err');
  if (!amount || isNaN(amount)) { errEl.textContent = 'Enter an amount'; errEl.style.display = ''; return; }
  if (amount < 5 || amount > 10000) { errEl.textContent = 'Amount must be $5-$10,000'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  const btn = document.getElementById('topup-create-btn');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const r = await fetch('/api/ai/topup', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:'xmr',amount,currency:'USD'})}).then(r=>r.json());
    if (!r.ok) { errEl.textContent = r.error || 'Failed'; errEl.style.display = ''; return; }
    _topupState.invoiceId = r.invoice_id;
    document.getElementById('topup-step1').style.display = 'none';
    document.getElementById('topup-step2').style.display = '';
    if (r.checkout_url) document.getElementById('topup-iframe').src = r.checkout_url;
    document.getElementById('topup-pay-amount').textContent = '$' + amount.toFixed(2);
    document.getElementById('topup-pay-status').textContent = 'Waiting for payment...';
    document.getElementById('topup-pay-status').style.color = 'var(--text-mid)';
    const expiresAt = r.expires_at * 1000;
    _topupState.countdownTimer = setInterval(() => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const timerEl = document.getElementById('topup-timer');
      timerEl.textContent = String(mins).padStart(2,'0') + ':' + String(secs).padStart(2,'0');
      timerEl.style.color = remaining < 120000 ? '#c05040' : 'var(--brown-dark)';
      if (remaining <= 0) {
        clearInterval(_topupState.countdownTimer);
        clearInterval(_topupState.pollTimer);
        document.getElementById('topup-pay-status').textContent = 'Expired';
        document.getElementById('topup-pay-status').style.color = '#c05040';
      }
    }, 1000);
    _topupState.pollTimer = setInterval(async () => {
      try {
        const st = await fetch('/api/ai/topup/status/' + _topupState.invoiceId).then(r=>r.json());
        if (st.status === 'Settled' || st.status === 'Complete') {
          clearInterval(_topupState.pollTimer);
          clearInterval(_topupState.countdownTimer);
          document.getElementById('topup-pay-status').textContent = 'Paid';
          document.getElementById('topup-pay-status').style.color = '#3a6a40';
          _fetchBalance();
          setTimeout(closeTopup, 1500);
        } else if (st.status === 'Expired' || st.status === 'Invalid') {
          clearInterval(_topupState.pollTimer);
          clearInterval(_topupState.countdownTimer);
          document.getElementById('topup-pay-status').textContent = st.status;
          document.getElementById('topup-pay-status').style.color = '#c05040';
        }
      } catch {}
    }, 5000);
  } catch(e) {
    errEl.textContent = e.message || 'Failed'; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Create Invoice';
  }
}

function _topupBack() {
  if (_topupState.pollTimer) clearInterval(_topupState.pollTimer);
  if (_topupState.countdownTimer) clearInterval(_topupState.countdownTimer);
  document.getElementById('topup-iframe').src = '';
  document.getElementById('topup-step1').style.display = '';
  document.getElementById('topup-step2').style.display = 'none';
}

async function saveSettings() {
  const newUnit = document.getElementById('set-weight-unit').value;
  await fetch('/api/settings', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      PPQ_API_KEY: document.getElementById('set-ppq-key').value,
      PPQ_CREDIT_ID: document.getElementById('set-ppq-credit-id').value,
      PPQ_BASE_URL: document.getElementById('set-ppq-url').value,
      PPQ_MODEL: document.getElementById('set-ppq-model').value,
      PPQ_IMAGE_MODEL: document.getElementById('set-ppq-img-model').value,
      PPQ_VISION_MODEL: document.getElementById('set-ppq-vis-model').value,
      EQUIPMENT: document.getElementById('set-equipment').value,
      WEIGHT_UNIT: newUnit,
    }),
  });
  _weightUnit = newUnit;
  ownedEquipmentNames = null;
  document.getElementById('settings-status').textContent = 'Saved.';
  setTimeout(() => document.getElementById('settings-status').textContent = '', 2000);
}

async function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm('This will overwrite your database, exercises, and settings with the backup contents. Continue?')) {
    input.value = '';
    return;
  }
  const status = document.getElementById('backup-status');
  status.style.display = 'block';
  status.textContent = 'Restoring backup...';
  const form = new FormData();
  form.append('backup', file);
  try {
    const resp = await fetch('/api/backup/restore', { method: 'POST', body: form });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Restore failed');
    const parts = [];
    if (data.db_restored) parts.push('database');
    if (data.exercises) parts.push(data.exercises + ' exercise' + (data.exercises === 1 ? '' : 's'));
    if (data.images) parts.push(data.images + ' image' + (data.images === 1 ? '' : 's'));
    status.textContent = 'Restored: ' + (parts.join(', ') || 'no data found');
    loadSettings();
  } catch(e) {
    status.textContent = 'Error: ' + e.message;
  }
  input.value = '';
}

