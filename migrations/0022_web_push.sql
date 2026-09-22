CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, owner_type TEXT NOT NULL DEFAULT 'parent',
  owner_id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  user_agent TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(org_id, endpoint) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner ON push_subscriptions(org_id, owner_type, owner_id, active);
CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, owner_type TEXT NOT NULL DEFAULT 'parent', owner_id TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'QUEUED',
  created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')), sent_at TEXT, error TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_notifications_owner ON push_notifications(org_id, owner_type, owner_id, status, created_at);