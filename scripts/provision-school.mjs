import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const value = process.argv[i];
  if (value.startsWith("--")) args.set(value, process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true);
}

const subdomain = String(args.get("--subdomain") || "").trim().toLowerCase();
const orgId = String(args.get("--org-id") || "").trim().toUpperCase();
const databaseName = `eduhaiti-db-${subdomain}`;
const binding = `DB_${orgId.replace(/[^A-Z0-9]+/g, "_")}`;
const apply = args.has("--apply");
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const zoneId = String(process.env.CLOUDFLARE_ZONE_ID || "").trim();
const pagesTarget = String(process.env.PAGES_TARGET_HOST || "eduflow-01k.pages.dev").trim();
const adminEmail = String(process.env.PROVISION_ADMIN_EMAIL || "").trim().toLowerCase();
const adminPasswordHash = String(process.env.PROVISION_ADMIN_PASSWORD_HASH || "").trim().toLowerCase();

function fail(message) {
  console.error(`Provisioning error: ${message}`);
  process.exit(1);
}

if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(subdomain)) fail("--subdomain must be a DNS-safe label.");
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

const read = (file) => fs.readFile(path.join(root, file), "utf8");
const write = (file, value) => fs.writeFile(path.join(root, file), value, "utf8");

const wrangler = ["wrangler", "d1", "create", databaseName];
console.log(JSON.stringify({ subdomain, orgId, binding, databaseName, pagesDomain: `${subdomain}.eduflow.win`, mode: apply ? "apply" : "dry-run" }, null, 2));
if (!apply) {
  console.log("Dry run only. Re-run with --apply from a protected CI/deployment environment.");
  process.exit(0);
}

const createOutput = run("npx", wrangler);
const idMatch = createOutput.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
if (!idMatch) fail("could not read the D1 database id from Wrangler output.");
const databaseId = idMatch[1];

run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=schema.sql"]);
const migrations = (await fs.readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
for (const migration of migrations) run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", `--file=migrations/${migration}`], { allowDuplicateColumn: true });

const adminSqlPath = path.join(os.tmpdir(), `eduflow-admin-${process.pid}.sql`);
const escapedEmail = adminEmail.replaceAll("'", "''");
const adminSql = `INSERT INTO users (id, user_id, email, username, name, password_hash, role, permissions_json, is_master, active, reset_required) VALUES ('${crypto.randomUUID()}', '${orgId}-ADMIN', '${escapedEmail}', '${escapedEmail}', 'Administrateur', '${adminPasswordHash}', 'ADMIN', '{"p_dossier":true,"p_staff":true,"p_settings":true,"p_audit":true,"pa_add_student":true,"pa_edit_student":true,"pa_manage_users":true}', 1, 1, 1);`;
await fs.writeFile(adminSqlPath, `${adminSql}\n`, "utf8");
try {
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file", adminSqlPath]);
} finally {
  await fs.rm(adminSqlPath, { force: true });
}

const wranglerPath = "wrangler.toml";
let wranglerConfig = await read(wranglerPath);
if (wranglerConfig.includes(`binding = "${binding}"`)) fail(`binding ${binding} already exists.`);
const d1Block = `[[d1_databases]]\nbinding = "${binding}"\ndatabase_name = "${databaseName}"\ndatabase_id = "${databaseId}"\n`;
wranglerConfig = wranglerConfig.replace("# SCHOOL_D1_BINDINGS_END", `${d1Block}\n# SCHOOL_D1_BINDINGS_END`);
await write(wranglerPath, wranglerConfig);

const tenantsPath = "src/lib/tenants.js";
let tenants = await read(tenantsPath);
if (tenants.includes(`${subdomain}:`)) fail(`tenant ${subdomain} already exists.`);
tenants = tenants.replace("  // SCHOOL_TENANTS_END", `  ${subdomain}: { orgId: "${orgId}", dbBinding: "${binding}" },\n  // SCHOOL_TENANTS_END`);
await write(tenantsPath, tenants);

const schoolDomain = `${subdomain}.eduflow.win`;
const cfHeaders = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

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

run("npx", ["wrangler", "deploy"]);
console.log(`Provisioned ${subdomain}.eduflow.win with isolated database ${databaseName}.`);
