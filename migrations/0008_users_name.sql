-- Adds the real Users sheet Name column used by staff-management responses
-- and teacher identity matching. Non-destructive for existing D1 users.
ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
