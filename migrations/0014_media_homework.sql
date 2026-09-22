-- Media Library + Homework port from Code.gs.
CREATE TABLE IF NOT EXISTS media_library (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT, type TEXT NOT NULL DEFAULT 'DOC', source TEXT NOT NULL DEFAULT 'URL',
  url TEXT, file_id TEXT, mime TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, thumbnail TEXT, cycle TEXT, level TEXT,
  classes_csv TEXT, subject TEXT, description TEXT, tags_csv TEXT, uploaded_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_org_updated ON media_library(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_media_org_type ON media_library(org_id,type);
CREATE TABLE IF NOT EXISTS homeworks (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, subject TEXT, subject_branch TEXT, period TEXT, cycle TEXT,
  classes_csv TEXT, description TEXT, due_date TEXT, max_score REAL NOT NULL, weight REAL NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_homeworks_org_updated ON homeworks(org_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_homeworks_org_due ON homeworks(org_id,due_date);
CREATE TABLE IF NOT EXISTS homework_grades (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, homework_id TEXT NOT NULL, student_id TEXT NOT NULL, student_name TEXT, class_name TEXT,
  score REAL NOT NULL DEFAULT 0, max_score REAL NOT NULL DEFAULT 0, comment TEXT, submitted_at TEXT, graded_by TEXT, graded_at TEXT,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hw_grade_student ON homework_grades(org_id,homework_id,student_id);
CREATE INDEX IF NOT EXISTS idx_hw_grades_org_hw ON homework_grades(org_id,homework_id);
CREATE INDEX IF NOT EXISTS idx_hw_grades_org_student ON homework_grades(org_id,student_id);
