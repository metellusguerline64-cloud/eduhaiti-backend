-- Migration 0020: adds `internal_notes` and `document_signatures` — new
-- tables, needed by the real port of addInternalNote_/getInternalNotes_
-- (+ their Student-prefixed aliases) and saveDocumentSignature_ (see
-- src/actions/notes.js). Purely additive — CREATE TABLE IF NOT EXISTS,
-- safe to run against any existing deployment.
--
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0020_internal_notes_document_signatures.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0020_internal_notes_document_signatures.sql
--
-- On a brand-new database, schema.sql already has both tables — this
-- migration is only needed if the database was created before this
-- port landed. (saveMedicalRecord_ needed no new table/migration — it
-- writes into the existing students.custom_fields JSON blob, same as
-- Code.gs's own CustomFields.medical convention.)

CREATE TABLE IF NOT EXISTS internal_notes (
  id            TEXT PRIMARY KEY,
  note_id       TEXT NOT NULL,
  org_id        TEXT NOT NULL,
  student_id    TEXT,
  content       TEXT NOT NULL DEFAULT '',
  author        TEXT,
  author_role   TEXT,
  meta_json     TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_internal_notes_student ON internal_notes(org_id, student_id);

CREATE TABLE IF NOT EXISTS document_signatures (
  id             TEXT PRIMARY KEY,
  signature_id   TEXT NOT NULL,
  org_id         TEXT NOT NULL,
  student_id     TEXT,
  document_type  TEXT NOT NULL DEFAULT 'General',
  signature_data TEXT NOT NULL DEFAULT '',
  signed_by      TEXT,
  signed_at      TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_document_signatures_student ON document_signatures(org_id, student_id);
