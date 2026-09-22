CREATE TABLE IF NOT EXISTS ai_provider_keys (
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY(org_id, provider)
);
