CREATE TABLE IF NOT EXISTS ai_appreciations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED',
  text TEXT NOT NULL DEFAULT '',
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_appreciations_student_period
  ON ai_appreciations(org_id, student_id, period_id);