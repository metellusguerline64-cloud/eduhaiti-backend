import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runStartedAt = Date.now();
function log(step, details = {}) {
  console.log(JSON.stringify({ component: "school-provisioning-runner", timestamp: new Date().toISOString(), step, ...details }));
}

function run(command, args) {
  // Avoid npx.cmd + shell=true on Windows: PowerShell/cmd re-splits D1 SQL
  // arguments at spaces and punctuation (e.g. SELECT ... FROM ...), making
  // Wrangler report the SQL words as unknown CLI arguments. Invoke the local
  // Wrangler JavaScript entry point through the current Node executable so
  // each argument, especially --command SQL, stays intact on every platform.
  const executable = command === "npx" ? process.execPath : command;
  const commandArgs = command === "npx"
    ? [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args.slice(1)]
    : args;
  const result = spawnSync(executable, commandArgs, {
    encoding: "utf8",
    env: process.env,
    shell: false,
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

function sql(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}

async function readRequestedOrgId() {
  const inline = process.argv.find((value) => value.startsWith("--org-id="));
  const index = process.argv.indexOf("--org-id");
  const cliValue = inline ? inline.slice("--org-id=".length) : index >= 0 ? process.argv[index + 1] : "";
  let event = {};
  if (!cliValue && process.env.GITHUB_EVENT_PATH) {
    try {
      event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    } catch (error) {
      throw new Error(`Unable to read GitHub event payload: ${error.message}`);
    }
  }
  const value = cliValue || process.env.PROVISION_ORG_ID || event.client_payload?.orgId || event.inputs?.org_id || "";
  const orgId = String(value).trim().toUpperCase();
  if (orgId && !/^[A-Z][A-Z0-9_]{2,31}$/.test(orgId)) {
    throw new Error("Requested --org-id is not a valid organization identifier.");
  }
  return orgId;
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

const targetOrgId = await readRequestedOrgId();
const prepareOnly = process.argv.includes("--prepare-only");
const targetFilter = targetOrgId ? ` AND business_id=${sql(targetOrgId)}` : "";
const failedRetryFilter = targetOrgId ? "1=1" : "updated_at <= STRFTIME('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes')";
const queueSql = `SELECT business_id, subdomain, email, phone, pin_hash, provisioning_status, provisioning_progress, provisioning_step FROM orgs WHERE deleted_at IS NULL AND (provisioning_status IN ('PENDING_PROVISIONING','PROVISIONING') OR (provisioning_status='PROVISIONING_FAILED' AND ${failedRetryFilter}))${targetFilter} ORDER BY created_at LIMIT 1`;
const raw = await runSql(queueSql, true);
const jsonStart = raw.indexOf("[");
const jsonEnd = raw.lastIndexOf("]");
if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("Wrangler did not return JSON output.");
const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
const pending = (payload[0]?.results || []);
log("queue_scanned", { scope: targetOrgId ? "requested_organization" : "one_oldest_pending_organization", targetOrgId: targetOrgId || null, pendingCount: pending.length, orgIds: pending.map((org) => String(org.business_id || "").trim()) });
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
    previousProgress: Number(org.provisioning_progress) || 0,
    previousStep: org.provisioning_step || null,
  });
  try {
    process.env.PROVISION_ADMIN_EMAIL = String(org.email || "").trim().toLowerCase();
    process.env.PROVISION_ADMIN_PASSWORD_HASH = String(org.pin_hash || "").trim().toLowerCase();
    // Passed through as-is (org.phone may already be in any of the
    // 509/+509/8-digit forms) — provision-school.mjs normalizes it before
    // writing to users.phone.
    process.env.PROVISION_ADMIN_PHONE = String(org.phone || "").trim();
    const previousProgress = Math.max(0, Math.min(100, Number(org.provisioning_progress) || 0));
    // Re-run the idempotent school preparation even for older 95% records.
    // This upgrades them into the registry used by the Cloudflare coordinator;
    // it does not publish the shared Worker or change any other tenant.
    // Preserve progress from an interrupted attempt; provision-school.mjs
    // records the next confirmed step and this runner never resets it to 5%.
    await runSql(`UPDATE orgs SET provisioning_status='PROVISIONING', provisioning_progress=MAX(COALESCE(provisioning_progress,0),5), provisioning_step=CASE WHEN COALESCE(provisioning_progress,0)>0 THEN provisioning_step ELSE 'Démarrage de la préparation' END, provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=${sql(orgId)}`);
    const provisionArgs = ["scripts/provision-school.mjs", "--subdomain", subdomain, "--org-id", orgId, "--apply"];
    log("provision_school_invocation", { orgId, subdomainJson: JSON.stringify(subdomain), subdomainLength: subdomain.length, args: provisionArgs });
    run("node", provisionArgs);
    prepared.push({ orgId, subdomain });
    log("organization_prepared", { orgId, subdomain, durationMs: Date.now() - orgStartedAt, nextStep: "cloudflare_worker_automatic_binding_activation" });
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
  for (const school of prepared) {
    await runSql("UPDATE orgs SET provisioning_status='PROVISIONING', provisioning_progress=MAX(COALESCE(provisioning_progress,0),90), provisioning_step='D1 prêt; activation automatique du Worker Cloudflare en attente', provisioning_error=NULL, updated_at=STRFTIME('%Y-%m-%dT%H:%M:%fZ','now') WHERE business_id=" + sql(school.orgId));
  }
  log("worker_deploy_skipped", { preparedCount: prepared.length, reason: "GitHub prepares the D1 only; the Cloudflare Worker coordinator attaches and activates it automatically" });
}
log("run_finished", { preparedCount: prepared.length, failedCount: failed.length, durationMs: Date.now() - runStartedAt });
