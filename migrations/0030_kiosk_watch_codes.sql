-- 0066: explicit compatibility marker for the legacy Settings key.
-- The key/value row lives in the existing `settings` table; this migration
-- intentionally adds no new table or per-file storage.
INSERT OR IGNORE INTO settings(key,value,updated_at)
VALUES('KIOSK_WATCH_CODES','[]',STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'));
