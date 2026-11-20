-- Daily TikTok trend reports (Thailand), made by a scheduled Claude run.
-- status: queued | running | succeeded | failed
CREATE TABLE trend_reports (
    id          TEXT PRIMARY KEY,
    day         TEXT NOT NULL,          -- local date the report is for, YYYY-MM-DD
    region      TEXT NOT NULL,
    status      TEXT NOT NULL,
    error       TEXT,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    finished_at TEXT
);
CREATE INDEX trend_reports_day ON trend_reports(day);
