import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function run(command, args) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`);
  return result.stdout || "";
}

function sql(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}

async function runSql(statement, json = false) {
  const file = path.join(os.tmpdir(), `eduflow-provision-${process.pid}.sql`);
  await fs.writeFile(file, `${statement.trim()}\n`, "utf8");
  try {
    const args = ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--file", file];
    if (json) args.push("--json");
    return run("npx", args);
  } finally {
    await fs.rm(file, { force: true });
  }
}

const raw = await runSql("SELECT business_id, subdomain, email, pin_hash, provisioning_status FROM orgs WHERE deleted_at IS NULL AND provisioning_status IN ('PENDING_PROVISIONING','PROVISIONING') ORDER BY created_at", true);
const jsonStart = raw.indexOf("[");
const jsonEnd = raw.lastIndexOf("]");
if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("Wrangler did not return JSON output.");
const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
const pending = (payload[0]?.results || []);
console.log(`Found ${pending.length} pending organization(s).`);

for (const org of pending) {
  const subdomain = String(org.subdomain || "").trim();
  const orgId = String(org.business_id || "").trim();
  const previousEmail = process.env.PROVISION_ADMIN_EMAIL;
  const previousHash = process.env.PROVISION_ADMIN_PASSWORD_HASH;
  if (!subdomain || !orgId) continue;
  try {
    process.env.PROVISION_ADMIN_EMAIL = String(org.email || "").trim().toLowerCase();
    process.env.PROVISION_ADMIN_PASSWORD_HASH = String(org.pin_hash || "").trim().toLowerCase();
    await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING', provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    run("node", ["scripts/provision-school.mjs", "--subdomain", subdomain, "--org-id", orgId, "--apply"]);
    await runSql(`UPDATE orgs SET provisioning_status='ACTIVE', provisioned_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'), provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    console.log(`Provisioned ${subdomain}.eduflow.win`);
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING_FAILED', provisioning_error=${sql(message)}, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    console.error(`Provisioning failed for ${subdomain}: ${message}`);
  } finally {
    if (previousEmail === undefined) delete process.env.PROVISION_ADMIN_EMAIL;
    else process.env.PROVISION_ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.PROVISION_ADMIN_PASSWORD_HASH;
    else process.env.PROVISION_ADMIN_PASSWORD_HASH = previousHash;
  }
}
