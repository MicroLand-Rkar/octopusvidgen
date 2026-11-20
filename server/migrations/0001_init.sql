CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- status: queued | running | succeeded | failed | canceled
CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    style_slug  TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    duration_s  INTEGER NOT NULL,
    aspect      TEXT NOT NULL,
    language    TEXT NOT NULL,
    status      TEXT NOT NULL,
    video_path  TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX jobs_user ON jobs(user_id, created_at);
CREATE INDEX jobs_status ON jobs(status, created_at);
