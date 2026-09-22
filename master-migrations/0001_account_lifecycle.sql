-- EDGE-0079: control-plane account lifecycle fields.
-- Keeps subscription expiration in MASTER_DB so account status evaluation
-- no longer depends on the retired Google Register sheet.
ALTER TABLE orgs ADD COLUMN expiration_date TEXT;
CREATE INDEX IF NOT EXISTS idx_orgs_expiration_date ON orgs(expiration_date);
