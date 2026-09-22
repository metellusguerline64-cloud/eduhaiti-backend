import assert from "node:assert/strict";
import { resolveTenantFromRequest, listTenants, scopedEnvForTenant, TENANTS } from "../src/lib/tenants.js";

console.log("=== tenants: known subdomain resolves ===");
{
  const req = new Request("https://mt1967.eduflow.win/?action=ping", { headers: { Host: "mt1967.eduflow.win" } });
  const tenant = resolveTenantFromRequest(req);
  assert.deepEqual(tenant, TENANTS.mt1967);
}

console.log("=== tenants: unknown subdomain resolves to null ===");
{
  const req = new Request("https://unknownschool.eduflow.win/?action=ping", { headers: { Host: "unknownschool.eduflow.win" } });
  assert.equal(resolveTenantFromRequest(req), null);
}

console.log("=== tenants: local dev host with port strips the port, still resolves by label ===");
{
  // wrangler dev default host is 127.0.0.1:8787 — no subdomain label to
  // match, so this must resolve to null too (not throw).
  const req = new Request("http://mt1967.localhost:8787/?action=ping", { headers: { Host: "mt1967.localhost:8787" } });
  const tenant = resolveTenantFromRequest(req);
  assert.deepEqual(tenant, TENANTS.mt1967);
}

console.log("=== tenants: listTenants returns every school with its subdomain attached ===");
{
  const all = listTenants();
  assert.ok(all.some((t) => t.subdomain === "mt1967" && t.orgId === "MT1967" && t.dbBinding === "DB_MT1967"));
}

console.log("=== tenants: scopedEnvForTenant maps the tenant's D1 binding onto env.DB ===");
{
  const fakeDb = { marker: "this-is-mt1967s-db" };
  const env = { DB_MT1967: fakeDb, SOME_OTHER_VAR: "untouched" };
  const scoped = scopedEnvForTenant(env, TENANTS.mt1967);
  assert.equal(scoped.DB, fakeDb);
  assert.equal(scoped.ORG_ID, "MT1967");
  assert.equal(scoped.SOME_OTHER_VAR, "untouched");
  // Original env must be left alone — scopedEnvForTenant must not mutate it,
  // since Workers can reuse env across requests / a school switching D1
  // mid-flight would be a serious cross-tenant data bug.
  assert.equal(env.DB, undefined);
}

console.log("=== tenants: scopedEnvForTenant throws clearly if the binding is missing ===");
{
  assert.throws(
    () => scopedEnvForTenant({}, { orgId: "GHOST", dbBinding: "DB_GHOST" }),
    /DB_GHOST/
  );
}

console.log("\nAll assertions passed.");
