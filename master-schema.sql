-- ============================================================
-- Meigens Tech — MASTER control-plane schema.
--
-- This is a SEPARATE D1 database from every school's own eduhaiti-db
-- (bound as MASTER_DB in wrangler.toml, never as DB). One database,
-- shared across every org Meigens Tech hosts (schools, churches,
-- businesses, hotels, carnet-épargne groups) — same scope the Google
-- Sheets "Register"/MASTER_AUTH_ID spreadsheet had (EduHaiti_create.txt's
-- "Universal Distributed Model"), now the account-creation interface's
-- backend instead of a spreadsheet+Apps Script pair.
--
-- Apply with:
--   npx wrangler d1 create meigens-master-db
--   npx wrangler d1 execute meigens-master-db --remote --file=./master-schema.sql
-- then paste the returned database_id into wrangler.toml's MASTER_DB block.
-- ============================================================

CREATE TABLE IF NOT EXISTS orgs (
  id             TEXT PRIMARY KEY,              -- uuid, our synthetic PK
  business_id    TEXT NOT NULL UNIQUE,          -- 'MT' + digits, port of generateBusinessId() —
                                                 -- checked for real uniqueness here (see accounts.js),
                                                 -- fixing the collision-prone no-check version flagged
                                                 -- earlier in EduHaiti_create.txt
  pin_hash       TEXT NOT NULL,                 -- SHA-256 hex, same hashPin() as the schools' own `users` table
  org_type       TEXT NOT NULL,                 -- 'BUSINESS' | 'CHURCH' | 'SCHOOL' | 'HOTEL' | 'CARNET_EPARGNE'
  business_name  TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT,
  subdomain      TEXT NOT NULL UNIQUE,          -- port of _generateUniqueSubdomain_/_slugify_ — this school's
                                                 -- future <subdomain>.eduflow.win
  reg_token      TEXT NOT NULL UNIQUE,          -- per-org secret used by that org's own Worker/app to prove
                                                 -- ownership of its subdomain claim (no shared secret across orgs)
  design_json    TEXT NOT NULL DEFAULT '{}',    -- 'ID_DESIGN_JSON' equivalent — logo, colors, ID-card layout
  rules_json     TEXT NOT NULL DEFAULT '{}',
  is_mother      INTEGER NOT NULL DEFAULT 0,    -- Mission Overseer feature, port of ensureMissionColumns_
  parent_org_id  TEXT,                          -- links a satellite org to its mission/mother org (this table's id)
  plan           TEXT NOT NULL DEFAULT 'FREE',  -- subscription plan
  expiration_date TEXT,                           -- subscription expiry; NULL means no explicit expiry
  -- SaaS settings identity fields (EDGE-0091) — mirrors the remaining
  -- getSaaSSettings_ Register columns not already covered above.
  -- Signup form location + branding (EDGE-0092) — département/commune the
  -- org selected, and its PWA icon as a data: URI (see migration 0003's
  -- header comment for why data: URI rather than an R2 key for now).
  department           TEXT,
  town                 TEXT,
  logo_data_url         TEXT,
  address             TEXT,
  payment_type        TEXT,
  picture_drive_link   TEXT,
  org_drive_folder_id  TEXT,
  student_portal_url   TEXT,
  staff_app_url        TEXT,
  contact_name         TEXT,
  -- AI PRO/FREE quota tiers (EDGE-0091) — port of Code.gs's per-org
  -- AI_PRO_ACCESS / AI_*_TOKEN_LIMIT_PRO / AI_*_TOKEN_LIMIT_FREE columns.
  ai_pro_access                INTEGER NOT NULL DEFAULT 0,
  ai_daily_token_limit_pro     INTEGER,
  ai_daily_token_limit_free    INTEGER,
  ai_session_token_limit_pro   INTEGER,
  ai_session_token_limit_free  INTEGER,
  ai_monthly_token_limit_pro   INTEGER,
  ai_monthly_token_limit_free  INTEGER,
  ai_pro_daily_pdf_limit       INTEGER,
  status         TEXT NOT NULL DEFAULT 'ACTIVE',-- 'ACTIVE' | 'SUSPENDED' — port of masterSetAccountStatus
  provisioning_status TEXT NOT NULL DEFAULT 'PENDING_PROVISIONING',
  provisioning_error  TEXT,
  provisioned_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_email ON orgs(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orgs_org_type ON orgs(org_type);
CREATE INDEX IF NOT EXISTS idx_orgs_parent ON orgs(parent_org_id);
