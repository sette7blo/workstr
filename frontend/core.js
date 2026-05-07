// ── State ────────────────────────────────────────────────────────────────────
let _weightUnit = 'kg'; // 'kg' or 'lb' — loaded from settings on init
let _drawerData = null;
const KG_TO_LB = 2.20462;
function _wLabel() { return _weightUnit; }
function _wDisplay(kg) { if (kg == null || kg === 0) return kg; return _weightUnit === 'lb' ? Math.round(kg * KG_TO_LB * 10) / 10 : kg; }
function _wStore(displayVal) { if (displayVal == null || displayVal === 0) return displayVal; return _weightUnit === 'lb' ? Math.round(displayVal / KG_TO_LB * 10) / 10 : displayVal; }
function _wFmt(kg) { if (kg == null || kg === 0) return ''; return _wDisplay(kg) + _wLabel(); }

let exercisesData = [];
let currentTab = 'exercises';
let searchQuery = '';
let filterCategory = '';
let filterMuscle = '';
let filterDifficulty = '';
let seedSelected = new Set();
let cameraFiles = [];
let seedDebounceTimer = null;
let wbExercises = []; // workout builder exercise list
let seedOffset = 0;
let seedTotal = 0;

// ── Sidebar & tabs ────────────────────────────────────────────────────────────

let _currentSubTabs = {}; // track active sub-tab per page

function switchTab(tab) {
  if (_selectMode) exitSelectMode();
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + tab);
  if (page) page.classList.add('active');

  // Show search bar only on exercises library sub-tab
  const activeSubTab = _currentSubTabs[tab];
  const showSearch = tab === 'exercises' && (!activeSubTab || activeSubTab === 'library' || activeSubTab === 'staging' || activeSubTab === 'trash');
  const searchEl = document.getElementById('search-wrap');
  if (searchEl) searchEl.style.display = showSearch ? 'flex' : 'none';
  const selBtn = document.getElementById('topbar-select-btn');
  if (selBtn) selBtn.style.display = (tab === 'exercises' && (!activeSubTab || activeSubTab === 'library')) ? '' : 'none';
  document.getElementById('search-input').value = '';
  searchQuery = '';

  // Load content for active sub-tab
  if (tab === 'exercises') _loadSubContent('exercises', activeSubTab || 'library');
  else if (tab === 'workouts') _loadSubContent('workouts', activeSubTab || 'programs');
  else if (tab === 'planner') _loadSubContent('planner', activeSubTab || 'plan');
  else if (tab === 'statistics') _loadSubContent('statistics', activeSubTab || 'training');
  else if (tab === 'settings') loadSettings();
  else if (tab === 'generate') { loadAiStatus(); clearGenerateForm(); }
  else if (tab === 'import') loadSeedFilters();
}

function switchSubTab(parentTab, subTab) {
  _currentSubTabs[parentTab] = subTab;
  const container = document.getElementById(parentTab + '-sub-tabs');
  if (container) {
    container.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t.dataset.subtab === subTab));
  }
  // Toggle sub-panels
  const page = document.getElementById('page-' + parentTab);
  if (page) {
    page.querySelectorAll('.sub-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'sub-' + parentTab + '-' + subTab);
    });
  }
  _loadSubContent(parentTab, subTab);

  // Update search bar visibility
  const showSearch = parentTab === 'exercises' && (subTab === 'library' || subTab === 'staging' || subTab === 'trash');
  const searchEl = document.getElementById('search-wrap');
  if (searchEl) searchEl.style.display = showSearch ? 'flex' : 'none';
  const selBtn = document.getElementById('topbar-select-btn');
  if (selBtn) selBtn.style.display = (parentTab === 'exercises' && subTab === 'library') ? '' : 'none';
}

function _loadSubContent(parentTab, subTab) {
  if (parentTab === 'exercises') {
    if (subTab === 'library') loadExercises('active');
    else if (subTab === 'staging') loadExercises('staged');
    else if (subTab === 'trash') loadExercises('trashed');
  } else if (parentTab === 'workouts') {
    if (subTab === 'programs') loadWorkouts();
    else if (subTab === 'mesocycles') loadMesocycles();
    else if (subTab === 'recovery') loadRecovery();
  } else if (parentTab === 'planner') {
    if (subTab === 'plan') loadPlanner();
    else if (subTab === 'history') loadHistory();
  } else if (parentTab === 'statistics') {
    if (subTab === 'training') loadStatistics();
    else if (subTab === 'body') loadBodyStats();
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) {
  if (!s && s !== 0) return '';
  const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML;
}

