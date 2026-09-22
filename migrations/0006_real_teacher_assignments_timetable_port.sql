-- Migration 0006: replace the generic `fields` JSON `teacher_assignments`
-- and `timetable` tables (still on the generic outbox sync engine,
-- src/lib/sync.js) with the REAL port verified against Code.gs's
-- ensureTeacherAssignmentsSheetStructure_/ensureTimetableSheetStructure_
-- and getStaffAssignments_/saveStaffAssignment_/deleteStaffAssignment_/
-- getTimetableData_/saveTimetableData_. See schema.sql for the
-- column-by-column mapping back to the real Sheet headers, and
-- src/actions/teacher_assignments.js / timetable.js for what was and
-- wasn't ported (notably: no payroll computation yet).
--
-- DESTRUCTIVE. This DROPs and recreates both tables, same convention as
-- migrations 0003/0004 for grades/attendance/payments. Only safe if no
-- real data has been written into the generic `fields` shape yet.
--
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0006_real_teacher_assignments_timetable_port.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0006_real_teacher_assignments_timetable_port.sql

DROP TABLE IF EXISTS teacher_assignments;

CREATE TABLE teacher_assignments (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  teacher_name   TEXT NOT NULL,
  teacher_id     TEXT,
  class_name     TEXT NOT NULL,
  class_id       TEXT,
  subject        TEXT,
  day            TEXT,
  start_time     TEXT,
  end_time       TEXT,
  hours          REAL NOT NULL DEFAULT 0,
  rate           REAL NOT NULL DEFAULT 0,
  salary         REAL NOT NULL DEFAULT 0,
  payment_mode   TEXT NOT NULL DEFAULT '',
  has_conflict   INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT,
  meta_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_teacher_assignments_composite
  ON teacher_assignments(org_id, teacher_name, class_name, subject, day, start_time);
CREATE INDEX idx_teacher_assignments_updated_at ON teacher_assignments(updated_at);

DROP TABLE IF EXISTS timetable;

CREATE TABLE timetable (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  class_name  TEXT,
  day_index   INTEGER NOT NULL DEFAULT 0,
  day_label   TEXT,
  start_time  TEXT,
  end_time    TEXT,
  subject     TEXT,
  teacher     TEXT,
  teacher_id  TEXT,
  conflict    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,
  meta_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_timetable_org_day ON timetable(org_id, day_index);
CREATE INDEX idx_timetable_updated_at ON timetable(updated_at);
