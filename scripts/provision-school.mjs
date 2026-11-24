import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { toLocalHaiti } from "../src/lib/phone.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (!value.startsWith("--")) continue;
  const equalsAt = value.indexOf("=");
  const key = equalsAt >= 0 ? value.slice(0, equalsAt) : value;
  if (equalsAt >= 0) {
    args.set(key, value.slice(equalsAt + 1));
  } else if (process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    args.set(key, process.argv[++i]);
  } else {
    args.set(key, true);
  }
}

const subdomain = String(args.get("--subdomain") || "").trim().toLowerCase();
const orgId = String(args.get("--org-id") || "").trim().toUpperCase();
const databaseName = `eduhaiti-db-${subdomain}`;
const binding = `DB_${orgId.replace(/[^A-Z0-9]+/g, "_")}`;
const apply = args.has("--apply");
const deferDeploy = args.has("--defer-deploy");
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim();
const pagesTarget = String(process.env.PAGES_TARGET_HOST || "eduflow-01k.pages.dev").trim();
const adminEmail = String(process.env.PROVISION_ADMIN_EMAIL || "").trim().toLowerCase();
const adminPasswordHash = String(process.env.PROVISION_ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
// Accepts 509XXXXXXXX, +509XXXXXXXX, or the bare 8-digit local number —
// toLocalHaiti() (src/lib/phone.js) collapses all three to the same
// canonical 8-digit local number before it's stored. This is a brand-new
// field (no legacy data to stay compatible with), so canonicalizing here
// is safe.
const adminPhone = toLocalHaiti(process.env.PROVISION_ADMIN_PHONE || "");
let currentStage = "input_validation";
const provisioningStartedAt = Date.now();
function log(step, details = {}) {
  console.log(JSON.stringify({ component: "school-provisioner", timestamp: new Date().toISOString(), orgId: orgId || null, subdomain: subdomain || null, stage: currentStage, step, ...details }));
}

function fail(message) {
  log("provisioning_failed", { message: String(message).replace(/Bearer\s+\S+/ig, "Bearer [redacted]").slice(0, 500), durationMs: Date.now() - provisioningStartedAt });
  console.error(`Provisioning error: ${message}`);
  process.exit(1);
}

if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) fail(`--subdomain must be a DNS-safe label; received ${JSON.stringify(subdomain)}.`);
if (!/^[A-Z][A-Z0-9_]{2,31}$/.test(orgId)) fail("--org-id must contain 3-32 uppercase letters, digits, or underscores.");
if (binding === "DB_MASTER_DB" || binding === "DB_DB_MT1967") fail("reserved binding name.");
if (apply && (!accountId || !apiToken)) fail("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required with --apply.");
if (apply && !zoneId) fail("CLOUDFLARE_ZONE_ID (the eduflow.win zone id) is required with --apply, to create the school's DNS record.");
if (apply && (!adminEmail || !/^[a-f0-9]{64}$/.test(adminPasswordHash))) fail("PROVISION_ADMIN_EMAIL and a SHA-256 PROVISION_ADMIN_PASSWORD_HASH are required with --apply.");

const run = (command, commandArgs, { allowDuplicateColumn = false } = {}) => {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, commandArgs, { cwd: root, env: process.env, encoding: "utf8" });
  if (result.status !== 0) {
    const output = result.stderr || result.stdout || "";
    // Migrations 0005/0007/0008/0019/0029 add columns that schema.sql already
    // ships on a brand-new database (see each file's own header comment) —
    // on a fresh school this ALTER TABLE is a documented no-op, not a real
    // failure, so it must not abort provisioning (wrangler.toml/tenants.js/
    // admin user/domain/deploy would otherwise never run for any new school).
    if (allowDuplicateColumn && /duplicate column name/i.test(output)) {
      console.warn(`Ignoring known no-op migration error (column already present on fresh schema): ${commandArgs.join(" ")}`);
      return result.stdout || "";
    }
    fail(`${command} ${commandArgs.join(" ")} failed:\n${output}`);
  }
  return result.stdout || "";
};

function setSignupProgress(progress, step) {
  const safeStep = String(step).replaceAll("'", "''");
  const value = Math.max(0, Math.min(99, Number(progress) || 0));
  run("npx", ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--command",
    `UPDATE orgs SET provisioning_progress=${value}, provisioning_step='${safeStep}', updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id='${orgId}'`]);
  log("progress_saved", { progress: value, progressStep: step });
}

const read = (file) => fs.readFile(path.join(root, file), "utf8");
const write = (file, value) => fs.writeFile(path.join(root, file), value, "utf8");
function parseWranglerJson(output, description) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) fail(`Wrangler returned invalid JSON while ${description}.`);
  try { return JSON.parse(output.slice(start, end + 1)); }
  catch { fail(`Wrangler returned invalid JSON while ${description}.`); }
}

const wrangler = ["wrangler", "d1", "create", databaseName];
console.log(JSON.stringify({ subdomain, orgId, binding, databaseName, pagesDomain: `${subdomain}.eduflow.win`, mode: apply ? "apply" : "dry-run", deploy: deferDeploy ? "deferred" : "immediate" }, null, 2));
if (!apply) {
  console.log("Dry run only. Re-run with --apply from a protected CI/deployment environment.");
  process.exit(0);
}

const cfHeaders = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
const databaseListUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?name=${encodeURIComponent(databaseName)}`;
currentStage = "d1_database";
log("database_lookup_started", { databaseName });
async function findDatabase() {
  const response = await fetch(databaseListUrl, { headers: cfHeaders });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) fail(`Could not check D1 database ${databaseName}: HTTP ${response.status}.`);
  return (body.result || []).find((item) => item.name === databaseName) || null;
}
let database = await findDatabase();
if (!database) {
  console.log(`Creating D1 database ${databaseName}...`);
  run("npx", wrangler);
  database = await findDatabase();
}
if (!database?.uuid) fail(`Could not create or find D1 database ${databaseName}.`);
const databaseId = database.uuid;
setSignupProgress(15, "Base de données dédiée créée");
log("database_ready", { databaseName, databaseId });
console.log(`Using D1 database ${databaseName} (${databaseId}).`);

currentStage = "schema_migrations";
log("schema_setup_started");
const tableRows = parseWranglerJson(run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','_migrations')", "--json"]), "checking the existing D1 schema")[0]?.results || [];
const existingTables = new Set(tableRows.map((row) => String(row.name || "")));
if (existingTables.has("users") && !existingTables.has("_migrations")) {
  fail("This D1 database already has application tables but no migration ledger. Provisioning stopped to avoid replaying old migrations; backfill _migrations once after checking the applied schema.");
}
const migrations = (await fs.readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ','now')))" ]);
run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=schema.sql"]);
const migrationRows = parseWranglerJson(run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", "SELECT name FROM _migrations", "--json"]), "checking migration history")[0]?.results || [];
const appliedMigrations = new Set(migrationRows.map((row) => String(row.name || "")));
for (const migration of migrations) {
  const name = path.parse(migration).name;
  if (appliedMigrations.has(name)) {
    console.log(`Migration already applied: ${migration}`);
    continue;
  }
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", `--file=migrations/${migration}`], { allowDuplicateColumn: true });
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--command", `INSERT OR IGNORE INTO _migrations (name) VALUES ('${name}')`]);
  console.log(`Migration applied: ${migration}`);
}
setSignupProgress(45, "Structure et modules configurés");
log("schema_setup_succeeded", { migrationCount: migrations.length });

currentStage = "admin_seed";
log("admin_seed_started");
const adminSqlPath = path.join(os.tmpdir(), `eduflow-admin-${process.pid}.sql`);
const escapedEmail = adminEmail.replaceAll("'", "''");
const escapedPhone = adminPhone.replaceAll("'", "''");
const adminSql = `INSERT OR IGNORE INTO users (id, user_id, email, username, name, password_hash, role, permissions_json, phone, is_master, active, reset_required) VALUES ('${crypto.randomUUID()}', '${orgId}-ADMIN', '${escapedEmail}', '${escapedEmail}', 'Administrateur', '${adminPasswordHash}', 'ADMIN', '{"p_dossier":true,"p_staff":true,"p_settings":true,"p_audit":true,"pa_add_student":true,"pa_edit_student":true,"pa_manage_users":true}', '${escapedPhone}', 1, 1, 1);`;
await fs.writeFile(adminSqlPath, `${adminSql}\n`, "utf8");
try {
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file", adminSqlPath]);
} finally {
  await fs.rm(adminSqlPath, { force: true });
}
// INSERT OR IGNORE keeps a retry from resetting a school's established PIN,
// but it can also silently ignore a conflicting email/user_id row. Verify the
// resulting tenant account before routing is deployed and the school marked
// ACTIVE; otherwise signup could expose a PWA whose admin cannot sign in.
const escapedAdminUserId = `${orgId}-ADMIN`.replaceAll("'", "''");
const adminSeedRows = parseWranglerJson(run("npx", [
  "wrangler", "d1", "execute", databaseName, "--remote", "--command",
  `SELECT user_id,email,role,active FROM users WHERE user_id='${escapedAdminUserId}' OR LOWER(email)=LOWER('${escapedEmail}') LIMIT 2`,
  "--json",
]), "verifying the seeded admin account")[0]?.results || [];
const seededAdmin = adminSeedRows.length === 1 ? adminSeedRows[0] : null;
if (!seededAdmin
    || String(seededAdmin.user_id || "").trim() !== `${orgId}-ADMIN`
    || String(seededAdmin.email || "").trim().toLowerCase() !== adminEmail
    || String(seededAdmin.role || "").trim().toUpperCase() !== "ADMIN"
    || Number(seededAdmin.active) === 0) {
  fail("Admin seed verification failed: expected exactly one active ADMIN matching the signup email and organization ID.");
}
console.log("Verified exactly one active PWA admin account for the registered organization.");
setSignupProgress(60, "Compte administrateur créé et vérifié");
log("admin_seed_verified");

currentStage = "tenant_routing";
const wranglerPath = "wrangler.toml";
let wranglerConfig = await read(wranglerPath);
const bindingBlock = wranglerConfig.split("[[d1_databases]]").find((block) => new RegExp(`^\\s*binding\\s*=\\s*"${binding}"`, "m").test(block));
if (bindingBlock) {
  const configuredName = bindingBlock.match(/^\s*database_name\s*=\s*"([^"]+)"/m)?.[1];
  const configuredId = bindingBlock.match(/^\s*database_id\s*=\s*"([^"]+)"/m)?.[1];
  if (configuredName !== databaseName || configuredId !== databaseId) fail(`binding ${binding} exists but points to a different database; refusing to overwrite it.`);
  console.log(`D1 binding already configured: ${binding}.`);
} else {
  const d1Block = `[[d1_databases]]\nbinding = "${binding}"\ndatabase_name = "${databaseName}"\ndatabase_id = "${databaseId}"\n`;
  if (!wranglerConfig.includes("# SCHOOL_D1_BINDINGS_END")) fail("wrangler.toml is missing SCHOOL_D1_BINDINGS_END marker.");
  wranglerConfig = wranglerConfig.replace("# SCHOOL_D1_BINDINGS_END", `${d1Block}\n# SCHOOL_D1_BINDINGS_END`);
  await write(wranglerPath, wranglerConfig);
}

const tenantsPath = "src/lib/tenants.js";
let tenants = await read(tenantsPath);
const tenantLine = tenants.split(/\r?\n/).find((line) => new RegExp(`^\\s*(?:"${subdomain}"|${subdomain})\\s*:`).test(line));
if (tenantLine) {
  if (!tenantLine.includes(`orgId: "${orgId}"`) || !tenantLine.includes(`dbBinding: "${binding}"`)) fail(`tenant ${subdomain} already exists with different routing; refusing to overwrite it.`);
  console.log(`Tenant routing already configured: ${subdomain}.`);
} else {
  if (!tenants.includes("// SCHOOL_TENANTS_END")) fail("tenants.js is missing SCHOOL_TENANTS_END marker.");
  tenants = tenants.replace("  // SCHOOL_TENANTS_END", `  "${subdomain}": { orgId: "${orgId}", dbBinding: "${binding}" },\n  // SCHOOL_TENANTS_END`);
  await write(tenantsPath, tenants);
}
setSignupProgress(72, "Routage de l’école configuré");
log("tenant_routing_ready", { binding });

currentStage = "pages_domain";
const schoolDomain = `${subdomain}.eduflow.win`;
const pagesResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/eduflow/domains`, {
  method: "POST",
  headers: cfHeaders,
  body: JSON.stringify({ name: schoolDomain }),
});
const pagesBody = await pagesResponse.json().catch(() => null);
// Code 8000018 = "already added this custom domain" — safe to ignore so the
// script is re-runnable (e.g. after the DNS step below failed previously).
const alreadyRegistered = pagesBody?.errors?.some((e) => e.code === 8000018);
if (!pagesResponse.ok && !alreadyRegistered) fail(`Pages custom domain failed: ${pagesResponse.status} ${JSON.stringify(pagesBody)}`);
setSignupProgress(80, "Adresse de l’application enregistrée");
log("pages_domain_registered", { schoolDomain, alreadyRegistered });

// Registering the domain on the Pages project does NOT by itself create the
// DNS record — that's a separate, required step. Without it the domain sits
// registered but unresolvable (this is exactly what happened with test1).
const existingRecords = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${schoolDomain}`, {
  headers: cfHeaders,
}).then((r) => r.json());
if (!existingRecords?.success) fail(`Could not check existing DNS records: ${JSON.stringify(existingRecords)}`);

if (existingRecords.result.length === 0) {
  const dnsResponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: "POST",
    headers: cfHeaders,
    body: JSON.stringify({ type: "CNAME", name: schoolDomain, content: pagesTarget, proxied: true, ttl: 1 }),
  });
  const dnsBody = await dnsResponse.json().catch(() => null);
  if (!dnsResponse.ok) fail(`DNS record creation failed: ${dnsResponse.status} ${JSON.stringify(dnsBody)}`);
} else {
  console.log(`DNS record for ${schoolDomain} already exists, skipping.`);
}
setSignupProgress(90, "Adresse réseau configurée; publication en cours");
log("dns_ready", { schoolDomain, recordAlreadyExisted: existingRecords.result.length > 0 });

if (deferDeploy) {
  currentStage = "waiting_for_shared_deploy";
  log("school_ready_for_batch_deploy", { durationMs: Date.now() - provisioningStartedAt });
  console.log(`Prepared ${subdomain}.eduflow.win with isolated database ${databaseName}; shared Worker deploy deferred to the batch runner.`);
} else {
  currentStage = "worker_deploy";
  log("worker_deploy_started");
  run("npx", ["wrangler", "deploy"]);
  run("npx", ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--command", `UPDATE orgs SET provisioning_status='ACTIVE', provisioning_progress=100, provisioning_step='Terminé', provisioned_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'), provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id='${orgId}'`]);
  log("provisioning_completed", { durationMs: Date.now() - provisioningStartedAt });
  console.log(`Provisioned ${subdomain}.eduflow.win with isolated database ${databaseName}.`);
}
