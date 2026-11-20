-- Trend reports for more than one platform (tiktok, youtube).
ALTER TABLE trend_reports ADD COLUMN platform TEXT NOT NULL DEFAULT 'tiktok';
