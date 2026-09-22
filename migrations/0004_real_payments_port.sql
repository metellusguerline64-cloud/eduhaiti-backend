-- Migration 0004: replace the generic `fields` JSON `payments` table
-- (still on the generic outbox sync engine, src/lib/sync.js) with the
-- REAL port verified against Code.gs's 'Finance' Sheet + recordNewPayment_
-- / voidPayment_ / editPayment_ / getStudentPayments_. See schema.sql
-- for the column-by-column mapping back to the real Sheet headers, and
-- src/actions/payments.js for what was and wasn't ported from
-- recordNewPayment_'s much larger tuition-schedule/penalty logic.
--
-- DESTRUCTIVE. This DROPs and recreates the table, same as migration
-- 0003 did for grades/attendance. Only safe if no real payments data
-- has been written into the generic `fields` shape yet — per the
-- blueprint's rollout plan, payments is a Phase 2 "high-stakes domain"
-- ported last, with Sheets/Apps Script staying authoritative until
-- diff-testing passes (Section 5, Phase 2). If you've already taken
-- live writes against the old generic shape, write a copy-forward
-- migration instead of running this as-is.
--
--   npx wrangler d1 execute eduhaiti-db --local  --file=./migrations/0004_real_payments_port.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0004_real_payments_port.sql

DROP TABLE IF EXISTS payments;

CREATE TABLE payments (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  history_id         TEXT,
  student_id         TEXT NOT NULL,
  student_name       TEXT,
  description        TEXT,
  amount             REAL NOT NULL,
  cashier_email      TEXT,
  status             TEXT NOT NULL DEFAULT 'PAID',
  notes              TEXT,
  payment_date       TEXT,
  reference          TEXT,
  client_request_id  TEXT,
  created_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at         TEXT
);

CREATE UNIQUE INDEX idx_payments_client_request_id
  ON payments(org_id, client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id != '';
CREATE INDEX idx_payments_student_org ON payments(student_id, org_id);
CREATE INDEX idx_payments_updated_at ON payments(updated_at);
