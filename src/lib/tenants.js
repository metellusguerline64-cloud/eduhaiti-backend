// Multi-tenant registry — one Worker serves every school, one D1 database
// per school. Cloudflare requires D1 bindings to be declared statically in
// wrangler.toml (there is no API to bind an arbitrary database_id at
// request time), so this table is the single place that maps a school's
// subdomain to the binding name wrangler.toml declares for it.
//
// Onboarding a new school (see also: scripts/onboard-school.js once that
// exists):
//   1. npx wrangler d1 create eduhaiti-db-<subdomain>
//   2. Add a [[d1_databases]] block in wrangler.toml with a fresh
//      `binding` (e.g. "DB_STMARC") and the database_id just returned.
//   3. npx wrangler d1 execute <db-name> --remote --file=./schema.sql
//   4. Add one line below.
//   5. npx wrangler deploy
//
// orgId is stamped into every row this school's Worker writes (org_id
// columns, audit_log, Generated_IDs/Badge sync filtering) — it does not
// need to be globally unique across schools since each school's data lives
// in its own database, but it must match whatever value that school's
// Badge sheet uses in its School ID / OrgID columns (see generatedIdsSync.js).
export const TENANTS = {
  mt1967: { orgId: "MT1967", dbBinding: "DB_MT1967" },
  // SCHOOL_TENANTS_START
  test1: { orgId: "TEST1", dbBinding: "DB_TEST1" },
  // SCHOOL_TENANTS_END
  // stmarc: { orgId: "STMARC", dbBinding: "DB_STMARC" },
};

// Host header -> tenant. Takes the left-most label ("mt1967" out of
// "mt1967.eduflow.win" or "mt1967.localhost:8787"), so this doesn't need
// to know the real production domain and keeps working under wrangler dev
// with a custom Host header for local testing.
export function resolveTenantFromRequest(request) {
  const host = String(request.headers.get("host") || "").toLowerCase();
  const subdomain = host.split(".")[0].split(":")[0].trim();
  return TENANTS[subdomain] || null;
}

// Used by the Cron trigger, which has no request/Host header to read —
// it has to iterate every known school instead of resolving just one.
export function listTenants() {
  return Object.entries(TENANTS).map(([subdomain, t]) => ({ subdomain, ...t }));
}

// Builds the per-request env view that the rest of the codebase already
// expects: apiHub, every action file, org.js, and generatedIdsSync.js all
// read env.DB / env.ORG_ID directly and have no idea multi-tenancy exists.
// This is deliberate — it's what keeps the 6 already-ported, already-tested
// domains untouched by this change.
export function scopedEnvForTenant(env, tenant) {
  const db = env[tenant.dbBinding];
  if (!db) {
    throw new Error(
      `Binding D1 "${tenant.dbBinding}" introuvable dans l'environnement — ` +
        `vérifiez le bloc [[d1_databases]] correspondant dans wrangler.toml.`
    );
  }
  return { ...env, DB: db, ORG_ID: tenant.orgId };
}
