-- EduHaïti — Certificates + public verification
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  certificate_no TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  certificate_type TEXT NOT NULL DEFAULT 'CERTIFICAT_SCOLAIRE',
  title TEXT NOT NULL DEFAULT 'Certificat',
  description TEXT NOT NULL DEFAULT '',
  school_year TEXT NOT NULL DEFAULT '',
  cycle TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  issue_date TEXT NOT NULL,
  issued_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ISSUED',
  verification_token TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_no ON certificates(certificate_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_verify ON certificates(verification_token);
CREATE INDEX IF NOT EXISTS idx_certificates_student ON certificates(student_id, issue_date);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status, issue_date);
