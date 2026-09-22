CREATE TABLE IF NOT EXISTS ai_user_configs (
  user_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);