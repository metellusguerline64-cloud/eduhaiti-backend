-- EDGE-0092: signup form location + branding fields.
--
-- Adds the department/town fields requested for the public signup page
-- (dropdown of Haiti's 10 départements, towns filtered by the chosen
-- département) plus logo_data_url so each org can carry its own PWA icon.
-- logo_data_url stores a data: URI (base64) directly in D1 — fine for the
-- small (<200KB) icon-sized images this form accepts; if logos grow larger
-- or need to be served at CDN speed later, migrate this column to an R2
-- object key instead of widening it.

ALTER TABLE orgs ADD COLUMN department TEXT;
ALTER TABLE orgs ADD COLUMN town TEXT;
ALTER TABLE orgs ADD COLUMN logo_data_url TEXT;
