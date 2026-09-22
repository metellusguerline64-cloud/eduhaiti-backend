import { spawnSync } from "node:child_process";

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
  // NOTE: this deliberately uses --command instead of writing the statement
  // to a temp file and passing --file. On the wrangler version this CI uses,
  // --file --json returns a broken payload for SELECTs: instead of the real
  // row data, "results" contains wrangler's own end-of-run stats summary
  // ({"Total queries executed":1,"Rows read":3,...}), with meta.changed_db
  // incorrectly true even for a read-only query. --command --json was
  // confirmed manually to return the correct shape ({"results":[{...real
  // row...}], meta.changed_db:false}), so every call here goes through
  // --command. spawnSync passes this as a literal argv element (no shell
  // involved except on Windows), so no manual quoting/escaping is needed.
  const args = ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--command", statement.trim()];
  if (json) args.push("--json");
  return run("npx", args);
}

const raw = await runSql("SELECT business_id, subdomain, email, pin_hash, provisioning_status FROM orgs WHERE deleted_at IS NULL AND provisioning_status IN ('PENDING_PROVISIONING','PROVISIONING') ORDER BY created_at", true);
console.log(`DEBUG raw wrangler stdout: ${raw}`);

const jsonStart = raw.indexOf("[");
const jsonEnd = raw.lastIndexOf("]");
if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("Wrangler did not return JSON output.");
const payload = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

// Wrangler's --json output can contain multiple top-level blocks (e.g. a
// results block and a separate stats/meta block). The old code assumed the
// real rows always live at payload[0].results, but on this wrangler version
// that position can instead hold the query-stats object (queries executed,
// rows read/written, database size) with no business_id/subdomain — which
// was silently treated as a single "pending org" with blank fields.
// Fix: scan every block's .results array and keep only entries that look
// like actual org rows (exclude anything shaped like the stats object).
let pending = [];
for (const block of payload) {
  if (Array.isArray(block?.results)) {
    pending = pending.concat(
      block.results.filter((r) => r && typeof r === "object" && !("Total queries executed" in r))
    );
  }
}

console.log(`Found ${pending.length} pending organization(s).`);

for (const org of pending) {
  console.log(`DEBUG raw org row: ${JSON.stringify(org)}`);
  const subdomain = String(org.subdomain || "").trim();
  const orgId = String(org.business_id || "").trim();
  const previousEmail = process.env.PROVISION_ADMIN_EMAIL;
  const previousHash = process.env.PROVISION_ADMIN_PASSWORD_HASH;
  if (!subdomain || !orgId) {
    console.warn(`Skipping org: missing subdomain ("${subdomain}") or business_id ("${orgId}").`);
    continue;
  }
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
