import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
let db = null;
let dbPath = null;
const stmtCache = new Map();

// Compile each SQL once and reuse the prepared statement. Always resolve the db
// first: getDb() detects a path change and clears the cache, so a cached
// statement can never outlive its database handle.
export function prep(sql) {
  const database = getDb();
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = database.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function getDbPath() {
  return process.env.WORKSTR_DB_STORE ?? join(root, 'data', 'workstr.db');
}

export function getDb() {
  const nextPath = getDbPath();
  if (db && dbPath === nextPath) return db;
  if (db) db.close();
  stmtCache.clear();
  mkdirSync(dirname(nextPath), { recursive: true });
  db = new DatabaseSync(nextPath);
  dbPath = nextPath;
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive migrations for databases created before a column existed.
function migrate(db) {
  const seCols = db.prepare('PRAGMA table_info(sheet_exercises)').all().map((c) => c.name);
  if (!seCols.includes('weight')) db.exec('ALTER TABLE sheet_exercises ADD COLUMN weight REAL');
  const sheetCols = db.prepare('PRAGMA table_info(sheets)').all().map((c) => c.name);
  if (!sheetCols.includes('is_temporary')) db.exec('ALTER TABLE sheets ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0');
  const exCols = db.prepare('PRAGMA table_info(exercises)').all().map((c) => c.name);
  if (!exCols.includes('nostr_event_id')) db.exec('ALTER TABLE exercises ADD COLUMN nostr_event_id TEXT');
  if (!exCols.includes('nostr_pubkey')) db.exec('ALTER TABLE exercises ADD COLUMN nostr_pubkey TEXT');
  if (!exCols.includes('nostr_address')) db.exec('ALTER TABLE exercises ADD COLUMN nostr_address TEXT');
  if (!exCols.includes('nostr_published_at')) db.exec('ALTER TABLE exercises ADD COLUMN nostr_published_at TEXT');
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category      TEXT DEFAULT '',
  muscle_group  TEXT DEFAULT '',
  muscles       TEXT NOT NULL DEFAULT '[]',
  equipment     TEXT NOT NULL DEFAULT '[]',
  difficulty    TEXT DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  instructions  TEXT NOT NULL DEFAULT '[]',
  image_url     TEXT DEFAULT '',
  favourite     INTEGER NOT NULL DEFAULT 0,
  default_sets  INTEGER NOT NULL DEFAULT 3,
  default_reps  TEXT NOT NULL DEFAULT '8-12',
  default_rest  INTEGER NOT NULL DEFAULT 90,
  source_type   TEXT NOT NULL DEFAULT 'manual',
  status        TEXT NOT NULL DEFAULT 'active',
  nostr_event_id     TEXT,
  nostr_pubkey       TEXT,
  nostr_address      TEXT,
  nostr_published_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A workout sheet: the routine you take to the gym. Published as kind:30078.
CREATE TABLE IF NOT EXISTS sheets (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  description         TEXT DEFAULT '',
  is_temporary        INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  nostr_event_id      TEXT,
  nostr_published_at  TEXT
);

CREATE TABLE IF NOT EXISTS sheet_exercises (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id      INTEGER NOT NULL,
  exercise_slug TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  sets          INTEGER NOT NULL DEFAULT 3,
  reps          TEXT NOT NULL DEFAULT '8-12',
  rest_sec      INTEGER NOT NULL DEFAULT 90,
  weight        REAL,
  notes         TEXT DEFAULT '',
  FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id     INTEGER,
  sheet_name   TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  notes        TEXT DEFAULT '',
  summary_event_id TEXT,
  FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS session_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL,
  exercise_slug TEXT NOT NULL,
  set_number    INTEGER NOT NULL,
  reps          INTEGER,
  weight        REAL,
  done          INTEGER NOT NULL DEFAULT 1,
  logged_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS body_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL UNIQUE,
  weight_kg   REAL NOT NULL,
  notes       TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL,
  slot      TEXT NOT NULL,
  sheet_id  INTEGER,
  notes     TEXT DEFAULT '',
  FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mesocycles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  goal        TEXT NOT NULL DEFAULT 'hypertrophy',
  start_date  TEXT NOT NULL,
  weeks       INTEGER NOT NULL DEFAULT 4,
  notes       TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);
CREATE INDEX IF NOT EXISTS idx_sheet_exercises_sheet ON sheet_exercises(sheet_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_session_sets_session ON session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_slug ON session_sets(exercise_slug);
CREATE INDEX IF NOT EXISTS idx_plan_date ON plan(date);
CREATE INDEX IF NOT EXISTS idx_body_date ON body_log(date);
`;

export function closeDbForTests() {
  if (db) db.close();
  db = null;
  dbPath = null;
  stmtCache.clear();
}
