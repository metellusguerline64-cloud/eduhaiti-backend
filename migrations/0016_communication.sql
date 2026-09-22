CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_announcements_org_updated ON announcements(org_id, updated_at);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_org_student ON incidents(org_id, json_extract(fields,'$.studentId'));

CREATE TABLE IF NOT EXISTS sp_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sp_messages_org_student ON sp_messages(org_id, json_extract(fields,'$.studentId'));
CREATE INDEX IF NOT EXISTS idx_sp_messages_org_thread ON sp_messages(org_id, json_extract(fields,'$.threadId'));

CREATE TABLE IF NOT EXISTS parent_msg_perms (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  can_reply INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parent_msg_perms_org_student ON parent_msg_perms(org_id, student_id);
