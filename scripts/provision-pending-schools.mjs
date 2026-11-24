import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runStartedAt = Date.now();
function log(step, details = {}) {
  console.log(JSON.stringify({ component: "school-provisioning-runner", timestamp: new Date().toISOString(), step, ...details }));
}

function run(command, args) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const combinedOutput = [result.stdout, result.stderr]
      .filter((part) => String(part || "").trim())
      .join("\n")
      .replace(/Bearer\s+\S+/ig, "Bearer [redacted]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "[email]")
      .slice(-5000);
    throw new Error(`${command} exited ${result.status ?? "unknown"}${result.error ? ` (${result.error.message})` : ""}${combinedOutput ? `\n${combinedOutput}` : ""}`);
  }
  return result.stdout || "";
}

function persistTenantRouting() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("--persist-routing is reserved for the configured GitHub Actions provisioner.");
  }
  run("git", ["config", "user.name", "github-actions[bot]"]);
  run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  run("git", ["add", "--", "wrangler.toml", "src/lib/tenants.js"]);
  const check = spawnSync("git", ["diff", "--cached", "--quiet"], { encoding: "utf8", env: process.env });
  if (check.status === 0) {
    console.log("Tenant routing is already committed; no source update needed.");
    return;
  }
  if (check.status !== 1) throw new Error(check.stderr || check.error?.message || "Unable to inspect staged tenant routing changes.");
  run("git", ["commit", "-m", "chore: register EduHaiti tenant routes"]);
  run("git", ["push"]);
  console.log("Tenant routing committed before the Worker deploy.");
}

function sql(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}

async function runSql(statement, json = false) {
  // D1's --file path uses the import endpoint and returns only an execution
  // summary, not SELECT rows. Read queries that need JSON results must use
  // --command so the provisioning queue receives business_id/subdomain values.
  if (json) {
    return run("npx", ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--command", statement.trim(), "--json"]);
  }

  const file = path.join(os.tmpdir(), `eduflow-provision-${process.pid}.sql`);
  await fs.writeFile(file, `${statement.trim()}\n`, "utf8");
  try {
    return run("npx", ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--file", file]);
  } finally {
    await fs.rm(file, { force: true });
  }
}

const raw = await runSql("SELECT business_id, subdomain, email, phone, pin_hash, provisioning_status FROM orgs WHERE deleted_at IS NULL AND (provisioning_status IN ('PENDING_PROVISIONING','PROVISIONING') OR (provisioning_status='PROVISIONING_FAILED' AND updated_at <= STRFTIME('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'))) ORDER BY created_at", true);
const jsonStart = raw.indexOf("[");
const jsonEnd = raw.lastIndexOf("]");
if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("Wrangler did not return JSON output.");
const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
const pending = (payload[0]?.results || []);
log("queue_scanned", { pendingCount: pending.length, orgIds: pending.map((org) => String(org.business_id || "").trim()) });
const prepared = [];
const failed = [];

for (const org of pending) {
  const subdomain = String(org.subdomain || "").trim();
  const orgId = String(org.business_id || "").trim();
  const previousEmail = process.env.PROVISION_ADMIN_EMAIL;
  const previousHash = process.env.PROVISION_ADMIN_PASSWORD_HASH;
  const previousPhone = process.env.PROVISION_ADMIN_PHONE;
  if (!subdomain || !orgId) {
    console.warn("Skipping pending organization: subdomain or business_id is missing.");
    failed.push("<missing-organization-fields>");
    continue;
  }
  const orgStartedAt = Date.now();
  const subdomainCodePoints = Array.from(subdomain, (character) => character.codePointAt(0).toString(16));
  log("organization_started", {
    orgId,
    subdomain,
    subdomainJson: JSON.stringify(subdomain),
    subdomainLength: subdomain.length,
    subdomainCodePoints,
    previousStatus: org.provisioning_status,
  });
  try {
    process.env.PROVISION_ADMIN_EMAIL = String(org.email || "").trim().toLowerCase();
    process.env.PROVISION_ADMIN_PASSWORD_HASH = String(org.pin_hash || "").trim().toLowerCase();
    // Passed through as-is (org.phone may already be in any of the
    // 509/+509/8-digit forms) — provision-school.mjs normalizes it before
    // writing to users.phone.
    process.env.PROVISION_ADMIN_PHONE = String(org.phone || "").trim();
    await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING', provisioning_progress=5, provisioning_step='Démarrage de la préparation', provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    const provisionArgs = ["scripts/provision-school.mjs", "--subdomain", subdomain, "--org-id", orgId, "--apply", "--defer-deploy"];
    log("provision_school_invocation", { orgId, subdomainJson: JSON.stringify(subdomain), subdomainLength: subdomain.length, args: provisionArgs });
    run("node", provisionArgs);
    prepared.push({ orgId, subdomain });
    log("organization_prepared", { orgId, subdomain, durationMs: Date.now() - orgStartedAt, nextStep: "shared_worker_deploy" });
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING_FAILED', provisioning_step='Nouvelle tentative automatique planifiée', provisioning_error=${sql(message)}, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    failed.push(subdomain);
    log("organization_failed", { orgId, subdomain, subdomainJson: JSON.stringify(subdomain), subdomainLength: subdomain.length, durationMs: Date.now() - orgStartedAt, errorName: error?.name || "Error", message: message.replace(/Bearer\s+\S+/ig, "Bearer [redacted]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "[email]").slice(-5000) });
  } finally {
    if (previousEmail === undefined) delete process.env.PROVISION_ADMIN_EMAIL;
    else process.env.PROVISION_ADMIN_EMAIL = previousEmail;
    if (previousHash === undefined) delete process.env.PROVISION_ADMIN_PASSWORD_HASH;
    else process.env.PROVISION_ADMIN_PASSWORD_HASH = previousHash;
    if (previousPhone === undefined) delete process.env.PROVISION_ADMIN_PHONE;
    else process.env.PROVISION_ADMIN_PHONE = previousPhone;
  }
}

if (failed.length) log("run_has_failures", { failedCount: failed.length, retry: "scheduled_workflow" });
if (failed.length) process.exitCode = 1;

if (prepared.length) {
  try {
    if (process.argv.includes("--persist-routing")) persistTenantRouting();
    log("shared_worker_deploy_started", { preparedCount: prepared.length });
    for (const school of prepared) await runSql(`UPDATE orgs SET provisioning_progress=95, provisioning_step='Publication du Worker partagé', updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(school.orgId)}`);
    run("npx", ["wrangler", "deploy"]);
    log("shared_worker_deploy_succeeded", { preparedCount: prepared.length });
    for (const school of prepared) {
      await runSql(`UPDATE orgs SET provisioning_status='ACTIVE', provisioning_progress=100, provisioning_step='Terminé', provisioned_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now'), provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(school.orgId)}`);
      log("organization_activated", { orgId: school.orgId, subdomain: school.subdomain });
    }
  } catch (error) {
    const message = String(error.message || error).slice(0, 1000);
    log("shared_worker_deploy_failed", { preparedCount: prepared.length, errorName: error?.name || "Error", message: message.replace(/Bearer\s+\S+/ig, "Bearer [redacted]").slice(0, 500) });
    for (const school of prepared) {
      await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING_FAILED', provisioning_step='Publication à relancer automatiquement', provisioning_error=${sql(message)}, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(school.orgId)}`);
    }
    throw error;
  }
}
log("run_finished", { preparedCount: prepared.length, failedCount: failed.length, durationMs: Date.now() - runStartedAt });
