import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { hashPin, } from "../src/lib/hash.js";
import { attemptSheetLogin, forcePasswordUpdate } from "../src/actions/auth.js";

const db = makeD1(":memory:");
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const phone = "+50912345678";
const userId = "MT9999-ADMIN";
await db.prepare(`INSERT INTO users (id,user_id,email,name,role,password_hash,permissions_json,is_master,active,reset_required)
  VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .bind("u-first-login", userId, "admin@first-login.ht", "Admin", "ADMIN", await hashPin("50912345678"),
    JSON.stringify({ p_dossier: true, p_staff: true, p_settings: true }), 1, 1, 1).run();

const env = { DB: db, ORG_ID: "MT9999" };
const initial = await attemptSheetLogin({ email: "admin@first-login.ht", password: phone }, null, env);
assert.equal(initial.success, true);
assert.equal(initial.status, "RESET_REQUIRED");

const updated = await forcePasswordUpdate({ oldPass: phone, newPass: "MonPinPersonnel2026" }, { token: initial.token }, env);
assert.equal(updated.success, true);
assert.equal(updated.status, "AUTHORIZED");
assert.ok(updated.token);

const oldLogin = await attemptSheetLogin({ email: "admin@first-login.ht", password: phone }, null, env);
assert.equal(oldLogin.success, false);
const newLogin = await attemptSheetLogin({ email: "admin@first-login.ht", password: "MonPinPersonnel2026" }, null, env);
assert.equal(newLogin.success, true);
assert.equal(newLogin.status, "AUTHORIZED");

console.log("first-login phone -> personal PIN flow passed");
