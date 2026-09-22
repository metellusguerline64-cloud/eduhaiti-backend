-- EduHaïti — admin-confirmed staff attendance store.
-- Self clock-in/out continues to live in the attendance table with
-- GradeLevelID='STAFF', matching Code.gs. This table is the companion
-- store for admin-confirmed LATE/ABSENT records used by payroll.
CREATE TABLE IF NOT EXISTS staff_attendance (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  email          TEXT NOT NULL,
  name           TEXT,
  status         TEXT NOT NULL,
  late_minutes   INTEGER NOT NULL DEFAULT 0,
  class_name     TEXT,
  confirmed_by   TEXT,
  timestamp      TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_org_email_date
  ON staff_attendance(org_id, email, timestamp);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_updated_at
  ON staff_attendance(updated_at);
