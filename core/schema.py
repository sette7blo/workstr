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
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS workouts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT,
    is_temporary  INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workout_exercises (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id      INTEGER NOT NULL,
    exercise_slug   TEXT NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    sets            INTEGER DEFAULT 3,
    reps            TEXT DEFAULT '8-12',
    weight          REAL,
    rest_sec        INTEGER DEFAULT 90,
    superset_group  TEXT,
    notes           TEXT,
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_slug) REFERENCES exercises(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id    INTEGER,
    workout_name  TEXT,
    started_at    TEXT DEFAULT (datetime('now')),
    finished_at   TEXT,
    notes         TEXT,
    FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workout_session_sets (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        INTEGER NOT NULL,
    exercise_slug     TEXT NOT NULL,
    set_number        INTEGER NOT NULL,
    prescribed_reps   TEXT,
    prescribed_weight REAL,
    actual_reps       INTEGER,
    actual_weight     REAL,
    notes             TEXT,
    FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT
);

CREATE TABLE IF NOT EXISTS mesocycles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    goal        TEXT DEFAULT 'hypertrophy',
    start_date  TEXT NOT NULL,
    weeks       INTEGER NOT NULL DEFAULT 4,
    notes       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mesocycle_weeks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    mesocycle_id  INTEGER NOT NULL,
    week_number   INTEGER NOT NULL,
    workout_ids   TEXT DEFAULT '[]',
    intensity_pct INTEGER DEFAULT 100,
    notes         TEXT,
    FOREIGN KEY (mesocycle_id) REFERENCES mesocycles(id) ON DELETE CASCADE,
    UNIQUE(mesocycle_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_exercises_status ON exercises(status);
CREATE INDEX IF NOT EXISTS idx_exercises_slug ON exercises(slug);
CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercises_muscle ON exercises(muscle_group);
CREATE INDEX IF NOT EXISTS idx_workout_plan_date ON workout_plan(date);
CREATE INDEX IF NOT EXISTS idx_workout_log_slug ON workout_log(exercise_slug);
CREATE INDEX IF NOT EXISTS idx_workout_log_date ON workout_log(logged_at);
CREATE INDEX IF NOT EXISTS idx_workout_exercises_workout ON workout_exercises(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_started ON workout_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_session_sets_session ON workout_session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_slug ON workout_session_sets(exercise_slug);
"""

MIGRATIONS = [
    "ALTER TABLE workout_plan ADD COLUMN workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL",
    "ALTER TABLE workout_sessions ADD COLUMN workout_name TEXT",
    "ALTER TABLE workouts ADD COLUMN is_temporary INTEGER DEFAULT 0",
]


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
    print("Database initialized: liftme.db")


if __name__ == "__main__":
    init_db()
