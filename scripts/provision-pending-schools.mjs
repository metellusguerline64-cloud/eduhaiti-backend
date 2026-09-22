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

// allowIgnore: an array of case-insensitive regexes. If the command fails
// AND its output matches one of these, the failure is treated as a known,
// safe no-op (e.g. "this table/column/binding already exists because a
// previous run got partway through") instead of aborting the whole script.
// This is what makes re-running provisioning for the same org safe after a
// partial failure (like the deploy step failing after everything else
// already succeeded) instead of crash-looping on "already exists" guards.
const run = (command, commandArgs, { allowIgnore = [] } = {}) => {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024, // 64MB — avoid silent truncation/ENOBUFS on verbose deploy output
  });
  if (result.status !== 0) {
    // result.error is set when spawnSync itself couldn't run/complete the
    // command (bad executable, killed by signal, buffer overrun, etc.) —
    // in that case result.stderr/result.stdout are often empty, and the
    // real cause was previously being silently dropped.
    const output = result.stderr || result.stdout || result.error?.message || "";
    const matched = allowIgnore.find((re) => re.test(output));
    if (matched) {
      console.warn(`Ignoring known no-op error (already applied on a previous run): ${commandArgs.join(" ")}`);
      return result.stdout || "";
    }
    const signalInfo = result.signal ? ` (terminated by signal ${result.signal})` : "";
    fail(`${command} ${commandArgs.join(" ")} failed${signalInfo}:\n${output || "(no output captured — see result.error/signal above)"}`);
  }
  return result.stdout || "";
};

const read = (file) => fs.readFile(path.join(root, file), "utf8");
const write = (file, value) => fs.writeFile(path.join(root, file), value, "utf8");

console.log(JSON.stringify({ subdomain, orgId, binding, databaseName, pagesDomain: `${subdomain}.eduflow.win`, mode: apply ? "apply" : "dry-run" }, null, 2));
if (!apply) {
  console.log("Dry run only. Re-run with --apply from a protected CI/deployment environment.");
  process.exit(0);
}

// --- 1. Create (or resume) the D1 database -------------------------------
let databaseId;
const createOutput = run("npx", ["wrangler", "d1", "create", databaseName], {
  allowIgnore: [/already exists/i],
});
const idMatch = createOutput.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i);
if (idMatch) {
  databaseId = idMatch[1];
} else {
  const listOutput = run("npx", ["wrangler", "d1", "list", "--json"]);
  let databases;
  try {
    databases = JSON.parse(listOutput);
  } catch {
    fail("could not read the D1 database id from Wrangler output, and 'wrangler d1 list --json' did not return parseable JSON either.");
  }
  const existing = (Array.isArray(databases) ? databases : []).find((d) => d?.name === databaseName);
  if (!existing?.uuid) fail(`could not find an existing D1 database named ${databaseName} via 'wrangler d1 list'.`);
  databaseId = existing.uuid;
  console.log(`Reusing existing D1 database ${databaseName} (${databaseId}) from a previous run.`);
}

// --- 2. Schema + migrations (idempotent) ----------------------------------
run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file=schema.sql"], {
  allowIgnore: [/already exists/i],
});
const migrations = (await fs.readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
for (const migration of migrations) {
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", `--file=migrations/${migration}`], {
    allowIgnore: [/duplicate column name/i, /already exists/i],
  });
}

// --- 3. Admin user (idempotent: INSERT OR IGNORE) -------------------------
const adminSqlPath = path.join(os.tmpdir(), `eduflow-admin-${process.pid}.sql`);
const escapedEmail = adminEmail.replaceAll("'", "''");
const adminSql = `INSERT OR IGNORE INTO users (id, user_id, email, username, name, password_hash, role, permissions_json, is_master, active, reset_required) VALUES ('${crypto.randomUUID()}', '${orgId}-ADMIN', '${escapedEmail}', '${escapedEmail}', 'Administrateur', '${adminPasswordHash}', 'ADMIN', '{"p_dossier":true,"p_staff":true,"p_settings":true,"p_audit":true,"pa_add_student":true,"pa_edit_student":true,"pa_manage_users":true}', 1, 1, 1);`;
await fs.writeFile(adminSqlPath, `${adminSql}\n`, "utf8");
try {
  run("npx", ["wrangler", "d1", "execute", databaseName, "--remote", "--file", adminSqlPath]);
} finally {
  await fs.rm(adminSqlPath, { force: true });
}

// --- 4. wrangler.toml binding (skip, don't fail, if already present) -----
const wranglerPath = "wrangler.toml";
let wranglerConfig = await read(wranglerPath);
if (wranglerConfig.includes(`binding = "${binding}"`)) {
  console.log(`Binding ${binding} already present in wrangler.toml, skipping (resumed run).`);
} else {
  const d1Block = `[[d1_databases]]\nbinding = "${binding}"\ndatabase_name = "${databaseName}"\ndatabase_id = "${databaseId}"\n`;
  wranglerConfig = wranglerConfig.replace("# SCHOOL_D1_BINDINGS_END", `${d1Block}\n# SCHOOL_D1_BINDINGS_END`);
  await write(wranglerPath, wranglerConfig);
}

// --- 5. tenants.js entry (skip, don't fail, if already present) ----------
const tenantsPath = "src/lib/tenants.js";
let tenants = await read(tenantsPath);
if (tenants.includes(`${subdomain}:`)) {
  console.log(`Tenant ${subdomain} already present in tenants.js, skipping (resumed run).`);
} else {
  tenants = tenants.replace("  // SCHOOL_TENANTS_END", `  ${subdomain}: { orgId: "${orgId}", dbBinding: "${binding}" },\n  // SCHOOL_TENANTS_END`);
  await write(tenantsPath, tenants);
}

// --- 6. Pages custom domain + DNS (already idempotent) --------------------
const schoolDomain = `${subdomain}.eduflow.win`;
const cfHeaders = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };

const pagesResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/eduflow/domains`, {
  method: "POST",
  headers: cfHeaders,
  body: JSON.stringify({ name: schoolDomain }),
});
const pagesBody = await pagesResponse.json().catch(() => null);
const alreadyRegistered = pagesBody?.errors?.some((e) => e.code === 8000018);
if (!pagesResponse.ok && !alreadyRegistered) fail(`Pages custom domain failed: ${pagesResponse.status} ${JSON.stringify(pagesBody)}`);

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

// --- 7. Deploy (always safe to re-run) ------------------------------------
run("npx", ["wrangler", "deploy"]);
console.log(`Provisioned ${subdomain}.eduflow.win with isolated database ${databaseName}.`);
