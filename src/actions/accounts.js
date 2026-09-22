// Port of EduHaiti_create.txt — the "Universal Distributed Model" backend
// that used to sit in front of the MASTER_SPREADSHEET_ID Register sheet
// (saveClientData() for signup, handleApiRequest_'s fetchConfig for
// activation lookups). These three actions are the account-creation
// interface's entire backend now — no Google Sheet involved.
//
// Deliberately NOT ported here (same "flag, don't silently drop"
// convention as the rest of this project):
// - ensureMissionColumns_/_mtGetMissionInfoForRow_'s full Mission Overseer
//   read/write surface — only the is_mother/parent_org_id columns exist
//   so far, not the satellite-management actions themselves.
// - The welcome-email send (TENANT_APP_DOMAIN email via MailApp) — the
//   caller (the signup page) gets tenantAppUrl back in the response and
//   is responsible for displaying/emailing it for now.
// - masterSetAccountStatus/masterChangeSubscriptionPlan (the master admin
//   dashboard's activate/suspend/change-plan actions) — those write to
//   this same `orgs` table's status/plan columns but belong with that
//   dashboard's own port, not the public signup surface.

import { hashPin } from "../lib/hash.js";
import { generateUniqueBusinessId, generateUniqueSubdomain, generateRegToken, slugify } from "../lib/accounts.js";
import { isValidDepartment, isValidTown } from "../lib/haitiLocalities.js";

const TENANT_APP_DOMAIN = "eduflow.win";
const ORG_TYPES = new Set(["BUSINESS", "CHURCH", "SCHOOL", "HOTEL", "CARNET_EPARGNE"]);
// Keep this in step with the signup form's file-size guard (src/signupPage.js) —
// a data: URI runs ~33% larger than the raw file, so 400KB of base64 text
// caps the original image around 300KB, generous for a PWA icon source.
const MAX_LOGO_DATA_URL_LENGTH = 400_000;
function isValidLogoDataUrl(value) {
  if (!value) return true; // logo is optional
  return typeof value === "string"
    && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(value)
    && value.length <= MAX_LOGO_DATA_URL_LENGTH;
}
function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function tenantAppUrl(subdomain) {
  return `https://${subdomain}.${TENANT_APP_DOMAIN}`;
}

// Port of saveClientData(): validates input, hashes the phone as the
// one-time initial credential, and inserts one `orgs` row. No spreadsheet append —
// this IS the insert.
export async function registerAccount(data, _auth, env) {
  const orgType = String(data.orgType || "SCHOOL").toUpperCase();
  const businessName = String(data.businessName || "").trim();
  const email = String(data.email || "").trim().toLowerCase();
  const phone = normalizePhone(data.phone);
  const department = String(data.department || "").trim();
  const town = String(data.town || "").trim();
  const logoDataUrl = data.logoDataUrl ? String(data.logoDataUrl) : null;
  // Company Mode: whether this org's IDs (student/member codes) should be
  // generated automatically and locked (SYSTEM_ID_MODE=COMPANY, see
  // src/lib/orgBilling.js's mapOrgRowToMasterData and school.js's legacy
  // getIdsGenerationMode_) versus entered manually. Chosen at signup here,
  // changeable later from that org's own settings screen — same
  // design_json.general.companyIdMode key that screen already writes to.
  const companyMode = data.companyMode === true || data.companyMode === "true" || data.companyMode === "ON";

  if (!businessName) return { success: false, message: "Le nom de l'organisation est requis." };
  if (!ORG_TYPES.has(orgType)) return { success: false, message: "Type d'organisation invalide." };
  if (!email || !email.includes("@")) return { success: false, message: "Email invalide." };
  if (phone.length < 7 || phone.length > 15) return { success: false, message: "Numéro de téléphone invalide." };
  if (!isValidDepartment(department)) return { success: false, message: "Département invalide." };
  if (!isValidTown(department, town)) return { success: false, message: "Ville invalide pour ce département." };
  if (!isValidLogoDataUrl(logoDataUrl)) return { success: false, message: "Logo invalide (PNG/JPEG/WebP, 300 Ko max)." };

  const existing = await env.MASTER_DB.prepare(
    `SELECT 1 FROM orgs WHERE LOWER(email) = ? AND deleted_at IS NULL`
  )
    .bind(email)
    .first();
  if (existing) return { success: false, message: "Un compte existe déjà avec cet email." };

  const id = crypto.randomUUID();
  const businessId = await generateUniqueBusinessId(env.MASTER_DB);
  const subdomain = await generateUniqueSubdomain(env.MASTER_DB, businessName);
  const regToken = generateRegToken();
  const pinHash = await hashPin(phone);
  const designJson = JSON.stringify({ general: { companyIdMode: companyMode ? "ON" : "OFF" } });

  await env.MASTER_DB.prepare(
    `INSERT INTO orgs (id, business_id, pin_hash, org_type, business_name, email, phone, subdomain, reg_token, department, town, logo_data_url, design_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, businessId, pinHash, orgType, businessName, email, phone, subdomain, regToken, department, town, logoDataUrl, designJson)
    .run();

  return {
    success: true,
    businessId,
    subdomain,
    provisioningStatus: "PENDING_PROVISIONING",
    companyMode,
    regToken,
    tenantAppUrl: tenantAppUrl(subdomain),
  };
}

// Port of handleApiRequest_'s "fetchConfig" branch: activation lookup by
// email + PIN, returning the same fields Code.gs's processActivation_ used
// to pull into that school's local Settings sheet — now the account-
// creation interface's "log back in to see your org" path instead.
export async function fetchConfig(data, _auth, env) {
  const email = String(data.email || "").trim().toLowerCase();
  const phone = normalizePhone(data.phone);
  if (!email || !phone) return { success: false, message: "Email et numéro de téléphone requis." };

  const row = await env.MASTER_DB.prepare(`SELECT * FROM orgs WHERE LOWER(email) = ? AND deleted_at IS NULL`)
    .bind(email)
    .first();
  if (!row) return { success: false, message: "Compte introuvable." };

  const pinHash = await hashPin(phone);
  if (String(row.pin_hash || "").toLowerCase() !== pinHash) {
    return { success: false, message: "PIN incorrect." };
  }
  if (row.status !== "ACTIVE") {
    return { success: false, message: "Compte suspendu. Contactez Meigens Tech." };
  }
  if (row.provisioning_status !== "ACTIVE") {
    return { success: false, message: "Votre espace est encore en cours de préparation. Réessayez dans quelques minutes." };
  }

  return {
    success: true,
    businessId: row.business_id,
    businessName: row.business_name,
    orgType: row.org_type,
    department: row.department,
    town: row.town,
    logoDataUrl: row.logo_data_url,
    designJson: row.design_json,
    rulesJson: row.rules_json,
    subdomain: row.subdomain,
    regToken: row.reg_token,
    tenantAppUrl: tenantAppUrl(row.subdomain),
  };
}

// New (had no Sheets equivalent — a linear column scan doubled as this in
// EduHaiti_create.txt). Lets the signup page validate a subdomain live as
// the org types their business name, instead of only finding out about a
// collision after submitting.
export async function checkSubdomainAvailable(data, _auth, env) {
  const subdomain = slugify(data.subdomain || data.businessName || "");
  if (!subdomain) return { success: false, message: "Nom invalide." };
  const exists = await env.MASTER_DB.prepare(
    `SELECT 1 FROM orgs WHERE subdomain = ? AND deleted_at IS NULL`
  )
    .bind(subdomain)
    .first();
  return { success: true, subdomain, available: !exists };
}
