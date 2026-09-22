-- Migration 0002: promote `grades` and `attendance` from the generic
-- fields-JSON shape to real typed columns (see schema.sql for the full
-- ⚠️ UNVERIFIED GUESS disclaimer — these column names are best-effort,
-- not a port of real Code.gs/Sheet headers).
--
-- DESTRUCTIVE. This DROPs and recreates both tables. That's only safe
-- because, per the blueprint's Phase 5 rollout plan, grades/attendance
-- haven't been cut over yet — Apps Script + Sheets is still the
-- authoritative backend for these two domains, so no real D1 data
-- should exist here to lose. If that's no longer true for your
-- deployment (i.e. this Worker has already been taking live
-- grades/attendance writes against the old `fields` JSON shape), do
-- NOT run this file as-is — write a version that copies `fields` data
-- into the new columns first.
--
-- Run once per environment:
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0002_promote_grades_attendance.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0002_promote_grades_attendance.sql

DROP TABLE IF EXISTS grades;
DROP TABLE IF EXISTS attendance;

CREATE TABLE grades (
  id               TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL,
  org_id           TEXT NOT NULL,
  class_id         TEXT,
  subject          TEXT,
  term             TEXT,
  evaluation_type  TEXT,
  score            REAL NOT NULL DEFAULT 0,
  max_score        REAL NOT NULL DEFAULT 100,
  coefficient      REAL NOT NULL DEFAULT 1,
  comment          TEXT,
  teacher_id       TEXT,
  recorded_at      TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at       TEXT
);
CREATE INDEX idx_grades_student_org ON grades(student_id, org_id);
CREATE INDEX idx_grades_updated_at ON grades(updated_at);

CREATE TABLE attendance (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL,
  org_id       TEXT NOT NULL,
  class_id     TEXT,
  date         TEXT NOT NULL,
  period       TEXT,
  status       TEXT NOT NULL DEFAULT 'PRESENT',
  recorded_by  TEXT,
  comment      TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at   TEXT
);
CREATE INDEX idx_attendance_student_org_date ON attendance(student_id, org_id, date);
CREATE INDEX idx_attendance_updated_at ON attendance(updated_at);
