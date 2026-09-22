-- Migration 0021: legacy Exam_Questions + class-wide maternelle checklist.
-- These preserve the remaining Code.gs action contracts while the newer
-- exams/exam_submissions model remains the source for the modern exam UI.

CREATE TABLE IF NOT EXISTS quiz_questions (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  exam_title      TEXT NOT NULL,
  question_text   TEXT NOT NULL DEFAULT '',
  option_a        TEXT NOT NULL DEFAULT '',
  option_b        TEXT NOT NULL DEFAULT '',
  option_c        TEXT NOT NULL DEFAULT '',
  option_d        TEXT NOT NULL DEFAULT '',
  correct_answer  TEXT NOT NULL DEFAULT '',
  commentary     TEXT NOT NULL DEFAULT '',
  media_type      TEXT NOT NULL DEFAULT '',
  media_url       TEXT NOT NULL DEFAULT '',
  points          REAL NOT NULL DEFAULT 5,
  question_type   TEXT NOT NULL DEFAULT 'mcq',
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version         INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_exam ON quiz_questions(org_id,exam_title,deleted_at,created_at);

CREATE TABLE IF NOT EXISTS maternal_curriculum_checks (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  check_id    TEXT NOT NULL,
  class_key   TEXT NOT NULL,
  row_key     TEXT NOT NULL,
  period      TEXT NOT NULL,
  mention     TEXT NOT NULL DEFAULT '',
  updated_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version     INTEGER NOT NULL DEFAULT 1,
  deleted_at  TEXT,
  UNIQUE(org_id,class_key,row_key,period)
);
CREATE INDEX IF NOT EXISTS idx_maternal_checks_class ON maternal_curriculum_checks(org_id,class_key,deleted_at);
