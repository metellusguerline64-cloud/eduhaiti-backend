-- EDGE-0080: preserve Code.gs audit permission/status semantics in D1.
ALTER TABLE audit_log ADD COLUMN permission TEXT;
ALTER TABLE audit_log ADD COLUMN status TEXT NOT NULL DEFAULT 'REUSSITE';
CREATE INDEX IF NOT EXISTS idx_audit_log_status_permission ON audit_log(status, permission);
