CREATE TABLE IF NOT EXISTS school_ids (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  student_code TEXT NOT NULL,
  school_id TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  date_value TEXT NOT NULL DEFAULT '',
  student_infos TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'CREATED',
  tracking_number TEXT NOT NULL DEFAULT '',
  form_url TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  photo_quality TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_ids_org_student
  ON school_ids(org_id, student_code);
CREATE INDEX IF NOT EXISTS idx_school_ids_org_updated
  ON school_ids(org_id, updated_at);