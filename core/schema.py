"""
core/schema.py — Database initialization and migrations
"""
from core.db import get_connection

SCHEMA = """
CREATE TABLE IF NOT EXISTS exercises (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    json_path       TEXT NOT NULL,
    image_url       TEXT,
    category        TEXT,
    muscle_group    TEXT,
    muscles         TEXT DEFAULT '[]',
    equipment_list  TEXT DEFAULT '[]',
    difficulty      TEXT,
    tags            TEXT DEFAULT '[]',
    instructions    TEXT DEFAULT '[]',
    source_type     TEXT DEFAULT 'manual',
    status          TEXT DEFAULT 'active',
    favorited       INTEGER DEFAULT 0,
    nostr_event_id  TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    category    TEXT,
    owned       INTEGER DEFAULT 0,
    notes       TEXT,
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    exercises   TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_plan (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    slot            TEXT NOT NULL,
    template_id     INTEGER,
    exercise_slug   TEXT,
    notes           TEXT,
    FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL,
    FOREIGN KEY (exercise_slug) REFERENCES exercises(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    exercise_slug   TEXT NOT NULL,
    logged_at       TEXT DEFAULT (datetime('now')),
    sets            TEXT DEFAULT '[]',
    duration_sec    INTEGER,
    notes           TEXT,
    FOREIGN KEY (exercise_slug) REFERENCES exercises(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT
);

CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);
CREATE INDEX IF NOT EXISTS idx_exercises_slug ON exercises(slug);
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle ON exercises(muscle_group);
CREATE INDEX IF NOT EXISTS idx_workout_plan_date ON workout_plan(date);
CREATE INDEX IF NOT EXISTS idx_workout_log_slug ON workout_log(exercise_slug);
CREATE INDEX IF NOT EXISTS idx_workout_log_date ON workout_log(logged_at);
"""

MIGRATIONS = []


def init_db():
    conn = get_connection()
    conn.executescript(SCHEMA)
    for sql in MIGRATIONS:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception:
            pass
    conn.close()
    print("Database initialized: workstr.db")


if __name__ == "__main__":
    init_db()
