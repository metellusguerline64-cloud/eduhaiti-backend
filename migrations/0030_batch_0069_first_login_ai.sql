CREATE TABLE IF NOT EXISTS email_otps (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires ON email_otps(expires_at);
CREATE TABLE IF NOT EXISTS ai_configuration_library (
  org_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  row_no INTEGER NOT NULL,
  row_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, dataset, row_no)
);
CREATE INDEX IF NOT EXISTS idx_ai_configuration_library_org_dataset ON ai_configuration_library(org_id,dataset);
