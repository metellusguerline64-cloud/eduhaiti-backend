-- Adds the columns from Code.gs's real USERS_HEADERS that schema.sql's
-- Phase 0 `users` table never had: PermissionsJSON, IsTeacher,
-- AssignedSubjects, PhotoURL, PayMode/PayRate/PayFixedSalary, Phone,
-- StartDate. Without permissions_json in particular, no action can ever
-- be permission-gated — see src/lib/permissions.js for why this matters
-- (permission is per-action, not per-role; Role alone was never enough).
--
-- Non-destructive (ALTER TABLE ADD COLUMN, existing rows keep working):
--   npx wrangler d1 execute eduhaiti-db --local --file=./migrations/0007_users_permissions.sql
--   npx wrangler d1 execute eduhaiti-db --remote --file=./migrations/0007_users_permissions.sql
-- On a brand-new database, apply schema.sql first as usual, then this.

ALTER TABLE users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}';   -- 'PermissionsJSON' — {key: true/false}, see src/lib/permissions.js
ALTER TABLE users ADD COLUMN is_teacher INTEGER NOT NULL DEFAULT 0;        -- 'IsTeacher'
ALTER TABLE users ADD COLUMN assigned_subjects TEXT NOT NULL DEFAULT '{}';  -- 'AssignedSubjects' — scope for STRICT_STUDENT_SCOPE_PERMISSION_KEYS holders
ALTER TABLE users ADD COLUMN photo_url TEXT;                                -- 'PhotoURL'
ALTER TABLE users ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '';            -- 'PayMode' — 'HOURLY' | 'FIXED' | '' (never guessed, same as teacher_assignments.payment_mode)
ALTER TABLE users ADD COLUMN pay_rate REAL NOT NULL DEFAULT 0;              -- 'PayRate'
ALTER TABLE users ADD COLUMN pay_fixed_salary REAL NOT NULL DEFAULT 0;      -- 'PayFixedSalary'
ALTER TABLE users ADD COLUMN phone TEXT;                                    -- 'Phone'
ALTER TABLE users ADD COLUMN start_date TEXT;                               -- 'StartDate'
ALTER TABLE users ADD COLUMN is_master INTEGER NOT NULL DEFAULT 0;          -- god-mode bypass, checked before ACTION_PERMISSIONS (see checkActionPermission)
ALTER TABLE users ADD COLUMN is_god_mode INTEGER NOT NULL DEFAULT 0;        -- toggled by 'toggleGodMode' action (pa_manage_users-gated, not yet ported)
