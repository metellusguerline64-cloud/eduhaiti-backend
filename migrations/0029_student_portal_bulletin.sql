-- EduHaïti 0063 — Student portal + bulletin authenticity registry
CREATE TABLE IF NOT EXISTS bulletin_verifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  verify_id TEXT NOT NULL,
  student_id TEXT,
  student_name TEXT,
  class_name TEXT,
  year TEXT,
  period TEXT,
  cycle_key TEXT,
  engine TEXT NOT NULL DEFAULT 'TRADITIONNEL',
  issued_at TEXT,
  issued_by TEXT,
  verify_url TEXT,
  last_verified_at TEXT,
  verify_count INTEGER NOT NULL DEFAULT 0,
  student_photo_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bulletin_verifications_org_verify ON bulletin_verifications(org_id,verify_id);
CREATE INDEX IF NOT EXISTS idx_bulletin_verifications_student ON bulletin_verifications(org_id,student_id);
