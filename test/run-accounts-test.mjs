// Runs the REAL accounts.js action code (not a copy) against sqlite, the
// same way run-payments-test.mjs verifies payments.js. This is the
// account-creation interface's backend (registerAccount/fetchConfig/
// checkSubdomainAvailable) — see src/signupPage.js for the frontend that
// calls these three actions.
//
//   npm install
//   node test/run-accounts-test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeD1 } from "./d1shim.mjs";
import { registerAccount, fetchConfig, checkSubdomainAvailable } from "../src/actions/accounts.js";

const DB_PATH = path.join(os.tmpdir(), "eduhaiti-accounts-test.sqlite");
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../master-schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

const env = { MASTER_DB: db };

console.log("=== registerAccount: rejects missing/invalid fields ===");
const noName = await registerAccount({ email: "a@b.ht" }, null, env);
console.assert(noName.success === false, "Missing businessName should fail", noName);

const badPhone = await registerAccount(
  { businessName: "École Bon Berger", orgType: "SCHOOL", email: "a@b.ht", phone: "123" },
  null,
  env
);
console.assert(badPhone.success === false, "Too-short phone should be rejected", badPhone);

console.log("=== registerAccount: happy path creates an org ===");
const created = await registerAccount(
  { businessName: "École Bon Berger", orgType: "SCHOOL", email: "admin@bonberger.ht", phone: "+50912345678" },
  null,
  env
);
console.assert(created.success === true, "Valid signup should succeed", created);
console.assert(created.businessId && created.businessId.startsWith("MT"), "businessId should look like MT#####", created);
console.assert(created.subdomain === "ecole-bon-berger", "Subdomain should be slugified (accents stripped)", created);
console.assert(created.regToken && created.tenantAppUrl.includes(created.subdomain), "Should return a regToken and matching tenantAppUrl", created);

console.log("=== registerAccount: duplicate email is rejected ===");
const dupe = await registerAccount(
  { businessName: "Autre École", orgType: "SCHOOL", email: "admin@bonberger.ht", phone: "+50956781234" },
  null,
  env
);
console.assert(dupe.success === false, "Duplicate email should be rejected", dupe);

console.log("=== registerAccount: name collision gets a numeric suffix, not an error ===");
const second = await registerAccount(
  { businessName: "École Bon Berger", orgType: "SCHOOL", email: "second@bonberger.ht", phone: "+50943211234" },
  null,
  env
);
console.assert(second.success === true && second.subdomain === "ecole-bon-berger-2", "Second org with same name should get -2 suffix", second);

console.log("=== checkSubdomainAvailable: reports taken vs free ===");
const taken = await checkSubdomainAvailable({ subdomain: "ecole-bon-berger" }, null, env);
console.assert(taken.success === true && taken.available === false, "Existing subdomain should be reported taken", taken);
const free = await checkSubdomainAvailable({ businessName: "Collège Nouvelle Vie" }, null, env);
console.assert(free.success === true && free.available === true, "Unused subdomain should be reported available", free);

console.log("=== fetchConfig: wrong phone / unknown email rejected ===");
const wrongPhone = await fetchConfig({ email: "admin@bonberger.ht", phone: "0000000000" }, null, env);
console.assert(wrongPhone.success === false, "Wrong phone should be rejected", wrongPhone);
const unknown = await fetchConfig({ email: "nobody@nowhere.ht", phone: "1234567890" }, null, env);
console.assert(unknown.success === false, "Unknown email should be rejected", unknown);

console.log("=== fetchConfig: correct email+phone returns the org config ===");
await db._raw.prepare(`UPDATE orgs SET provisioning_status = 'ACTIVE' WHERE email = 'admin@bonberger.ht'`).run();
const ok = await fetchConfig({ email: "admin@bonberger.ht", phone: "+50912345678" }, null, env);
console.assert(ok.success === true && ok.subdomain === "ecole-bon-berger" && ok.businessName === "École Bon Berger", "Correct credentials should return the org", ok);

console.log("=== fetchConfig: suspended org is rejected even with the right phone ===");
await db._raw.prepare(`UPDATE orgs SET status = 'SUSPENDED' WHERE email = 'admin@bonberger.ht'`).run();
const suspended = await fetchConfig({ email: "admin@bonberger.ht", phone: "+50912345678" }, null, env);
console.assert(suspended.success === false, "Suspended org should be rejected", suspended);

console.log("All accounts assertions ran (see any 'Assertion failed' lines above for failures).");
