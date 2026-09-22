-- EDGE-0091: full multi-tenant SaaS settings port.
--
-- Code.gs's getSaaSSettings_ read two layers: a per-org row in the shared
-- "Register" spreadsheet (billing plan, expiration, AI PRO/FREE token
-- quotas, contact/identity fields) merged UNDER that school's own local
-- Settings sheet (which could override anything). orgs already carries
-- business_name/email/phone/org_type/plan/expiration_date/design_json/
-- rules_json (EDGE-0079/provisioning work) — this migration adds the
-- remaining identity fields and the AI PRO/FREE quota tier columns that
-- src/lib/settings.js's own header comment flagged as still missing, so
-- src/lib/orgBilling.js has real columns to read.
--
-- AI_PLAN_QUOTAS (the old shared quota sheet) was already retired in
-- Code.gs in favor of per-org columns (see docs/settings-source.txt's
-- "Quota configuration is now expected per org in Register" comment) —
-- this migration continues that, not a new design.

ALTER TABLE orgs ADD COLUMN address TEXT;
ALTER TABLE orgs ADD COLUMN payment_type TEXT;
ALTER TABLE orgs ADD COLUMN picture_drive_link TEXT;
ALTER TABLE orgs ADD COLUMN org_drive_folder_id TEXT;
ALTER TABLE orgs ADD COLUMN student_portal_url TEXT;
ALTER TABLE orgs ADD COLUMN staff_app_url TEXT;
ALTER TABLE orgs ADD COLUMN contact_name TEXT;

-- AI PRO/FREE quota tiers. ai_pro_access is the org-level entitlement flag
-- (Code.gs's AI_PRO_ACCESS); the *_pro/*_free columns are the two-tier
-- limit pairs (Code.gs kept both an "AI_PRO_..." prefix family and an
-- "..._PRO"/"..._FREE" suffix family for the same values — this schema
-- keeps just one canonical column per limit, which is what
-- src/lib/orgBilling.js maps back onto both legacy spellings).
ALTER TABLE orgs ADD COLUMN ai_pro_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN ai_daily_token_limit_pro INTEGER;
ALTER TABLE orgs ADD COLUMN ai_daily_token_limit_free INTEGER;
ALTER TABLE orgs ADD COLUMN ai_session_token_limit_pro INTEGER;
ALTER TABLE orgs ADD COLUMN ai_session_token_limit_free INTEGER;
ALTER TABLE orgs ADD COLUMN ai_monthly_token_limit_pro INTEGER;
ALTER TABLE orgs ADD COLUMN ai_monthly_token_limit_free INTEGER;
ALTER TABLE orgs ADD COLUMN ai_pro_daily_pdf_limit INTEGER;
