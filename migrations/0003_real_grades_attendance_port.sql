-- Migration 0003: replace the unverified-guess `grades`/`attendance`
-- schema (from migration 0002) with the REAL port verified against
-- Code.gs's SHEET_DEFS + saveManualExamGrade_ / getGrades_ /
-- recordAttendance_ / recordBulkAttendance_ / getAttendanceForStudent_.
-- See schema.sql for the column-by-column mapping back to the real
-- Sheet headers.
--
-- DESTRUCTIVE. This DROPs and recreates both tables again, same as
-- 0002 was. Only safe if no real grades/attendance data has been
-- written into the guessed shape yet (per the blueprint's rollout
-- plan, grades/attendance are ported last and Apps Script/Sheets
-- stays authoritative until diff-testing passes — Section 5, Phase 2).
-- If you've already taken live writes against the 0002 shape, write a
-- copy-forward migration instead of running this as-is.
--
-- Run once per environment, in order (0002 then 0003), or straight to
-- 0003 on a fresh database that only ever ran schema.sql (schema.sql
-- already has the real shape as of this port, so 0003 is a no-op
-- there beyond the DROP/CREATE):
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0003_real_grades_attendance_port.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0003_real_grades_attendance_port.sql

DROP TABLE IF EXISTS grades;
DROP TABLE IF EXISTS attendance;

CREATE TABLE grades (
  id               TEXT PRIMARY KEY,
  history_id       TEXT,
  student_id       TEXT NOT NULL,
  org_id           TEXT NOT NULL,
  grade_level_id   TEXT,
  subject_id       TEXT NOT NULL,
  period_id        TEXT,
  score            REAL,
  mention          TEXT,
  teacher_id       TEXT,
  scores_json      TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version          INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT
);
CREATE UNIQUE INDEX idx_grades_student_subject_history
  ON grades(org_id, student_id, subject_id, IFNULL(history_id, ''));
CREATE INDEX idx_grades_updated_at ON grades(updated_at);

CREATE TABLE attendance (
  id             TEXT PRIMARY KEY,
  history_id     TEXT,
  student_id     TEXT NOT NULL,
  org_id         TEXT NOT NULL,
  grade_level_id TEXT,
  date           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PRESENT',
  recorded_by    TEXT,
  meta_json      TEXT NOT NULL DEFAULT '{}',
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX idx_attendance_student_org_date ON attendance(student_id, org_id, date);
CREATE INDEX idx_attendance_updated_at ON attendance(updated_at);
