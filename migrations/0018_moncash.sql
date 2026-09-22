-- MonCash tenant-isolated payment transactions.
-- Credentials are stored encrypted in settings as MONCASH_CONFIG_ENC and are
-- decrypted only inside the Worker with the MONCASH_CREDENTIALS_KEY secret.
CREATE TABLE IF NOT EXISTS moncash_payments (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL,
  student_id               TEXT NOT NULL,
  user_id                  TEXT,
  amount                   REAL NOT NULL,
  amount_due               REAL NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'HTG',
  payment_type             TEXT NOT NULL DEFAULT 'TUITION',
  description              TEXT NOT NULL DEFAULT '',
  order_id                 TEXT NOT NULL,
  moncash_transaction_id   TEXT,
  moncash_reference        TEXT,
  status                   TEXT NOT NULL DEFAULT 'PENDING',
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  paid_at                  TEXT,
  raw_response             TEXT,
  version                  INTEGER NOT NULL DEFAULT 1,
  deleted_at               TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_moncash_order
  ON moncash_payments(org_id, order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_moncash_transaction
  ON moncash_payments(org_id, moncash_transaction_id)
  WHERE moncash_transaction_id IS NOT NULL AND moncash_transaction_id != '';
CREATE INDEX IF NOT EXISTS idx_moncash_student
  ON moncash_payments(org_id, student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moncash_status
  ON moncash_payments(org_id, status, updated_at);
