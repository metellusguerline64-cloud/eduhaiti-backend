-- 0062: Parent portal / self-service accounts.
CREATE TABLE IF NOT EXISTS parent_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_accounts_org_phone ON parent_accounts(org_id, phone) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS parent_students (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_students_link ON parent_students(org_id,parent_id,student_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(org_id,parent_id);

CREATE TABLE IF NOT EXISTS parent_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  student_codes_raw TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  rejection_reason TEXT,
  parent_id TEXT,
  push_owner_id TEXT,
  resolved_students_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_parent_requests_org_phone ON parent_requests(org_id,phone,status);
CREATE INDEX IF NOT EXISTS idx_parent_requests_org_status ON parent_requests(org_id,status,created_at);
