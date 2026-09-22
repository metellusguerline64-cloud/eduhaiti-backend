// EDGE-0091 — full multi-tenant SaaS settings port.
//
// Code.gs's getSaaSSettings_ read a per-org row from the shared "Register"
// spreadsheet (billing plan, expiration, AI PRO/FREE quotas, identity
// fields) as the DEFAULT layer, then let that school's own local Settings
// sheet override anything (`Object.assign({}, masterData, local)`).
//
// One Worker deployment serves every school (src/lib/tenants.js), and
// MASTER_DB is bound alongside each school's own DB (wrangler.toml), so
// this is the direct equivalent: look up this tenant's own `orgs` row by
// business_id (== env.ORG_ID, see src/lib/tenants.js/TENANTS) and map it
// onto the same masterData keys src/actions/settings.js already knows how
// to merge and alias-forward-fill.
//
// Deliberately NOT covered here (same as before EDGE-0091): the write
// path. updateSaaSSettings/updateLocalSettings still only ever write to
// the tenant's own `settings` table, same as Code.gs's persistSettingsEntries_
// only ever wrote to the local Settings sheet — billing/plan fields on
// `orgs` are managed by the master admin dashboard's own port
// (masterSetAccountStatus/masterChangeSubscriptionPlan), not by a school
// admin's own settings screen.

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

// Returns this tenant's own `orgs` row, or null if MASTER_DB isn't bound
// (local/test environments, and any env predating EDGE-0091) or the row
// can't be found — callers treat both as "no master layer, local settings
// only", exactly Code.gs's behavior when the Register sheet lookup failed.
export async function getOrgBillingRow(env) {
  if (!env?.MASTER_DB || !env?.ORG_ID) return null;
  try {
    return await env.MASTER_DB.prepare(
      `SELECT id, business_id, subdomain, business_name, email, phone, org_type,
              address, payment_type, picture_drive_link, org_drive_folder_id,
              student_portal_url, staff_app_url, contact_name,
              plan, expiration_date, status, design_json, rules_json,
              ai_pro_access, ai_daily_token_limit_pro, ai_daily_token_limit_free,
              ai_session_token_limit_pro, ai_session_token_limit_free,
              ai_monthly_token_limit_pro, ai_monthly_token_limit_free,
              ai_pro_daily_pdf_limit, created_at
       FROM orgs WHERE business_id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(env.ORG_ID).first();
  } catch (_) {
    // Missing MASTER_DB binding or pre-EDGE-0091 schema without these
    // columns yet — degrade to "no master layer" rather than fail the
    // whole settings read.
    return null;
  }
}

// Maps an `orgs` row onto the legacy masterData keys getSaaSSettings_ used
// to build from the Register spreadsheet. buildMerged() in
// src/actions/settings.js already knows how to alias-forward-fill these
// capitalized keys onto the camelCase ones the frontend reads.
export function mapOrgRowToMasterData(row) {
  if (!row) return null;
  const design = safeJsonParse(row.design_json);
  const rules = safeJsonParse(row.rules_json);

  const masterData = {
    SCHOOL_NAME: row.business_name || "",
    BUSINESS_NAME: row.business_name || "",
    ORG_NAME: row.business_name || "",
    ORG_ID: row.business_id || "",
    SCHOOL_CODE: row.business_id || "",
    ORG_REGISTER_ID: row.business_id || "",
    ORG_TYPE: row.org_type || "",
    SCHOOL_EMAIL: row.email || "",
    EMAIL: row.email || "",
    SCHOOL_PHONE: row.phone || "",
    PHONE: row.phone || "",
    TRANSACTION_PHONE: row.phone || "",
    SCHOOL_ADDR: row.address || "",
    ADDRESS: row.address || "",
    CONTACT_NAME: row.contact_name || "",
    NAME: row.contact_name || "",
    PICTURE_DRIVE_LINK: row.picture_drive_link || "",
    ORG_DRIVE_FOLDER_ID: row.org_drive_folder_id || "",
    STUDENT_PORTAL_URL: row.student_portal_url || "",
    STAFF_APP_URL: row.staff_app_url || "",
    SUBSCRIPTION_PLAN: row.plan || "",
    EXPIRATION_DATE: row.expiration_date || "",
    PAYMENT_TYPE: row.payment_type || "",
    DATE_CREATED: row.created_at || "",
    ACCOUNT_STATUS: row.status || "",
    SYSTEM_ID_MODE: "COMPANY",
    SYSTEM_ID_PREFIX: "MT",
    AI_PRO_ACCESS: row.ai_pro_access ? "TRUE" : "",
    AI_PRO_DAILY_TOKEN_LIMIT: row.ai_daily_token_limit_pro ?? "",
    AI_FREE_DAILY_TOKEN_LIMIT: row.ai_daily_token_limit_free ?? "",
    AI_DAILY_TOKEN_LIMIT_PRO: row.ai_daily_token_limit_pro ?? "",
    AI_DAILY_TOKEN_LIMIT_FREE: row.ai_daily_token_limit_free ?? "",
    AI_PRO_SESSION_TOKEN_LIMIT: row.ai_session_token_limit_pro ?? "",
    AI_FREE_SESSION_TOKEN_LIMIT: row.ai_session_token_limit_free ?? "",
    AI_SESSION_TOKEN_LIMIT_PRO: row.ai_session_token_limit_pro ?? "",
    AI_SESSION_TOKEN_LIMIT_FREE: row.ai_session_token_limit_free ?? "",
    AI_PRO_MONTHLY_TOKEN_LIMIT: row.ai_monthly_token_limit_pro ?? "",
    AI_FREE_MONTHLY_TOKEN_LIMIT: row.ai_monthly_token_limit_free ?? "",
    AI_MONTHLY_TOKEN_LIMIT_PRO: row.ai_monthly_token_limit_pro ?? "",
    AI_MONTHLY_TOKEN_LIMIT_FREE: row.ai_monthly_token_limit_free ?? "",
    AI_PRO_DAILY_PDF_LIMIT: row.ai_pro_daily_pdf_limit ?? "",
    // Code.gs's masterData also always carried the plain (non-tier)
    // AI_DAILY_TOKEN_LIMIT / AI_SESSION_TOKEN_LIMIT / AI_MONTHLY_TOKEN_LIMIT
    // keys (Register columns read by getSaaSSettings_, and required by
    // _ensureRegisterAiQuotaHeaders_). There's no separate non-tier column
    // in `orgs` — the per-org tier (PRO/FREE) IS the effective limit — so
    // these mirror whichever tier this org is on, for key-level parity with
    // anything reading the plain spelling.
    AI_DAILY_TOKEN_LIMIT: row.ai_pro_access ? (row.ai_daily_token_limit_pro ?? "") : (row.ai_daily_token_limit_free ?? ""),
    AI_SESSION_TOKEN_LIMIT: row.ai_pro_access ? (row.ai_session_token_limit_pro ?? "") : (row.ai_session_token_limit_free ?? ""),
    AI_MONTHLY_TOKEN_LIMIT: row.ai_pro_access ? (row.ai_monthly_token_limit_pro ?? "") : (row.ai_monthly_token_limit_free ?? ""),
  };

  // design_json — same fields Code.gs read out of ID_DESIGN_JSON.
  if (design?.visuals?.logoUrl) masterData.SCHOOL_LOGO = design.visuals.logoUrl;
  if (!masterData.SCHOOL_ADDR && design?.contact?.address) {
    masterData.SCHOOL_ADDR = design.contact.address;
    masterData.ADDRESS = design.contact.address;
  }
  if (design?.general?.schoolName) {
    const name = String(design.general.schoolName).trim();
    if (name) { masterData.SCHOOL_NAME = name; }
  }
  if (design?.general?.promotion) {
    masterData.CURRENT_ACADEMIC_YEAR = String(design.general.promotion).trim();
  }
  if (design?.general?.companyIdMode === "ON") masterData.SYSTEM_ID_MODE = "COMPANY";

  // rules_json — same fields Code.gs read out of ID_RULES_JSON.
  const prefix = rules?.codeGeneration?.prefix || rules?.idPrefix;
  if (prefix) masterData.SYSTEM_ID_PREFIX = prefix;

  return masterData;
}

// Convenience wrapper for callers (settings.js, ai_tokens.js) that just
// want the mapped masterData object, or null when there's no master layer.
export async function getOrgMasterData(env) {
  const row = await getOrgBillingRow(env);
  return mapOrgRowToMasterData(row);
}

// AI PRO/FREE tier limit resolution. Code.gs's ai token-status code chose
// the *_PRO or *_FREE limit based on AI_PRO_ACCESS; local per-tenant
// settings (DAILY_TOKEN_LIMIT etc.) still win when explicitly set, so an
// admin can hand-override the tier default without touching MASTER_DB.
export function resolveAiTierLimits(row) {
  if (!row) return { daily: 0, monthly: 0, session: 0, dailyPdf: 0, tier: "FREE" };
  const isPro = !!row.ai_pro_access;
  return {
    tier: isPro ? "PRO" : "FREE",
    daily: Number(isPro ? row.ai_daily_token_limit_pro : row.ai_daily_token_limit_free) || 0,
    monthly: Number(isPro ? row.ai_monthly_token_limit_pro : row.ai_monthly_token_limit_free) || 0,
    session: Number(isPro ? row.ai_session_token_limit_pro : row.ai_session_token_limit_free) || 0,
    dailyPdf: Number(row.ai_pro_daily_pdf_limit) || 0,
  };
}
