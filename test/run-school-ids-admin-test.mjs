import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { getSchoolIdsRecords, upsertSchoolIdRecord } from "../src/actions/school_ids.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-school-ids-admin-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0023_school_ids.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key,value) VALUES ('ORG_ID','ORG1')`).run();
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,permissions_json,active) VALUES ('admin','A1','admin@test','Admin','hash','{"p_settings":true}',1)`).run();
db._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES ('session','admin','admin@test','{"userId":"admin","email":"admin@test"}',?)`).run(Date.now()+3600000);
const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== admin can create and list a School ID record ===");
const created = await upsertSchoolIdRecord({ record: { "Student Code": "MT-123", "School ID": "SID-1", Class: "NS1", Status: "CREATED" } }, { token: "session" }, env);
console.assert(created.success === true && created.record.generatedId === "SID-1" && created.row === 2, "Record should be created with legacy row contract", created);
const listed = await getSchoolIdsRecords({}, { token: "session" }, env);
console.assert(listed.success === true && listed.records.length === 1 && listed.records[0].studentCode === "MT-123", "Record should be listed", listed);

console.log("=== same student/tracking updates instead of duplicating ===");
const updated = await upsertSchoolIdRecord({ studentCode: "MT123", schoolId: "SID-2", trackingNumber: "MT123", status: "UPDATED" }, { token: "session" }, env);
console.assert(updated.success === true && updated.message === "Record mis à jour.", "Record should update", updated);
const afterUpdate = await getSchoolIdsRecords({}, { token: "session" }, env);
console.assert(afterUpdate.records.length === 1 && afterUpdate.records[0].generatedId === "SID-2" && updated.row === 2, "Update must not duplicate and must expose row", { afterUpdate, updated });

console.log("=== legacy prefix-tolerant matching ===");
const prefixUpdated = await upsertSchoolIdRecord({ studentCode: "123", schoolId: "SID-3", trackingNumber: "123" }, { token: "session" }, env);
console.assert(prefixUpdated.success === true && prefixUpdated.message === "Record mis à jour.", "Prefix variants must match like Code.gs", prefixUpdated);
const afterPrefix = await getSchoolIdsRecords({}, { token: "session" }, env);
console.assert(afterPrefix.records.length === 1 && afterPrefix.records[0].generatedId === "SID-3", "Prefix-tolerant update must not duplicate", afterPrefix);

console.log("=== School ID fallback when student/tracking is absent ===");
const bySchoolId = await upsertSchoolIdRecord({ schoolId: "CARD-77", className: "NS2" }, { token: "session" }, env);
console.assert(bySchoolId.success === true && bySchoolId.message === "Record ajouté.", "School ID should create when no student/tracking exists", bySchoolId);
const bySchoolIdUpdate = await upsertSchoolIdRecord({ schoolId: "CARD77", className: "NS3" }, { token: "session" }, env);
console.assert(bySchoolIdUpdate.success === true && bySchoolIdUpdate.message === "Record mis à jour.", "School ID should be the fallback match", bySchoolIdUpdate);

console.log("=== School ID is required ===");
const invalid = await upsertSchoolIdRecord({ studentCode: "MT999" }, { token: "session" }, env);
console.assert(invalid.success === false && /School ID requis/.test(invalid.error), "Missing School ID should be rejected", invalid);

console.log("\nAll assertions passed.");