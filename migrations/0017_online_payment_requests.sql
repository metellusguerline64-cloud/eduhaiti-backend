-- EduHaïti — online payment request queue (Code.gs: online_payment_requests)
CREATE TABLE IF NOT EXISTS online_payment_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  history_id TEXT,
  grade_level_id TEXT,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'MonCash',
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  receipt_id TEXT,
  proof_file_url TEXT,
  proof_file_name TEXT,
  proof_file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_online_payment_requests_student
  ON online_payment_requests(org_id, student_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_online_payment_requests_pending
  ON online_payment_requests(org_id, status, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_online_payment_requests_id
  ON online_payment_requests(org_id, id);
