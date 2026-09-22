-- D1 replacement for the Drive/Spreadsheet annual archive used by Code.gs.
CREATE TABLE IF NOT EXISTS academic_year_archives (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  year TEXT NOT NULL,
  next_year TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  closed_by TEXT,
  snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_academic_year_archives_org_closed ON academic_year_archives(org_id,closed_at DESC);
