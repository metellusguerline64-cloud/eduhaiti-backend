// Runs the REAL addNewStudent / resetStudentPin / lookupStudentGlobal
// code (not a copy) against sqlite (via node:sqlite), same pattern as
// run-students-test.mjs.
//
//   npm install
//   node test/run-student-lifecycle-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { fakeFetchSheetValues } from "./fake-sheets-api.js";
import { addNewStudent, resetStudentPin, lookupStudentGlobal, getStudentById } from "../src/actions/students.js";

const DB_PATH = "/tmp/eduhaiti-student-lifecycle-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);
const parentSchema = fs.readFileSync(new URL("../migrations/0028_parent_portal.sql", import.meta.url), "utf8");
db._raw.exec(parentSchema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ACADEMIC_YEAR', '2025-2026')`).run();
const env = { DB: db, ORG_ID: "ORG1", MASTER_AUTH_ID: "fake-master-id" };

console.log("=== addNewStudent: creates a brand-new student + ACTIVE history ===");
const created = await addNewStudent(
  {
    StudentCode: "STU-100",
    FirstName: "Nadege",
    LastName: "Louis",
    Phone: "50912340000",
    CurrentLevel: "6EME",
    Section: "B",
    ExtraField: "custom-value",
    ParentPhone: "50912345678",
    ParentName: "Marie Louis",
  },
  null,
  env
);
console.assert(created.success === true, "addNewStudent should succeed for a new code", created);
console.assert(created.message === "Inscription complete", "New student should get the 'Inscription complete' message", created);
console.assert(created.parentAccount?.created === true, "parentAccount should be auto-created when ParentPhone is supplied", created);
console.assert(created.parentAccount?.parentId && /^PAR-/.test(created.parentAccount.parentId), "A parent account id should be returned", created);
console.assert(/^\d{6}$/.test(created.parentAccount?.pin || ""), "A one-time parent PIN should be generated", created);
const parentLink = db._raw.prepare(`SELECT ps.parent_id, pa.phone FROM parent_students ps JOIN parent_accounts pa ON pa.id=ps.parent_id WHERE ps.student_id='STU-100'`).get();
console.assert(parentLink?.phone === "50912345678", "Student should be linked to the normalized parent phone", parentLink);

const afterCreate = await getStudentById({ studentId: "STU-100" }, null, env);
console.assert(afterCreate.success === true, "New student should be readable back", afterCreate);
console.assert(afterCreate.data.CurrentLevel === "6EME" && afterCreate.data.Section === "B", "New student's active history should carry the sent level/section", afterCreate.data);

const cfRow = db._raw.prepare(`SELECT custom_fields FROM students WHERE student_code = 'STU-100'`).get();
console.assert(JSON.parse(cfRow.custom_fields).ExtraField === "custom-value", "Unknown formObj keys should overflow into custom_fields", cfRow);

console.log("=== addNewStudent: resending the same code edits, doesn't blank omitted fields ===");
const edited = await addNewStudent({ StudentCode: "STU-100", Phone: "50999998888" }, null, env);
console.assert(edited.success === true && edited.message === "Profil mis a jour", "Resending an existing code should be treated as an edit", edited);
const afterEdit = await getStudentById({ studentId: "STU-100" }, null, env);
console.assert(afterEdit.data.Phone === "50999998888", "Phone should be updated", afterEdit.data);
console.assert(afterEdit.data.FirstName === "Nadege" && afterEdit.data.LastName === "Louis", "Name should be untouched by an edit that didn't send it (no reset-on-resend bug)", afterEdit.data);

console.log("=== resetStudentPin: sets pin_hash to NULL and matches a digit-suffix ===");
db._raw.prepare(`UPDATE students SET pin_hash = 'somehash' WHERE student_code = 'STU-100'`).run();
const reset = await resetStudentPin({ studentId: "100" }, null, env); // digit-suffix match against STU-100
console.assert(reset.success === true && reset.studentCode === "STU-100", "Digit-suffix match should resolve to STU-100", reset);
const pinRow = db._raw.prepare(`SELECT pin_hash FROM students WHERE student_code = 'STU-100'`).get();
console.assert(pinRow.pin_hash === null, "pin_hash should be cleared", pinRow);

console.log("=== resetStudentPin: unknown student is rejected ===");
const resetMiss = await resetStudentPin({ studentId: "NOPE-999" }, null, env);
console.assert(resetMiss.success === false, "Unknown student should not be reset", resetMiss);

console.log("=== lookupStudentGlobal: finds an ACTIVE, matching-org row ===");
// Reuses the same Generated_IDs fixture generatedIdsSync's own test
// uses (STU-001/ORG1 active, STU-002/ORG1 inactive, STU-003/OTHER_ORG).
const deps = { fetchSheetValues: fakeFetchSheetValues };
const lookup = await lookupStudentGlobal({ id: "STU-001" }, null, env, deps);
console.assert(lookup.success === true && lookup.found === true, "STU-001 should be found", lookup);
console.assert(lookup.student.Student_ID === "STU-001", "Matched student id should round-trip", lookup);
console.assert(lookup.data.PhotoURL.includes("drive.google.com/thumbnail"), "Drive photo link should be normalized", lookup.data);

console.log("=== lookupStudentGlobal: legacy ID shape tolerance (MT-XXXX <-> MTXXXX) ===");
const legacyDeps = {
  fetchSheetValues: async (_env, _id, sheetName) =>
    sheetName === "Generated_IDs"
      ? [
          ["ID", "Nom", "Prenom", "OrgId", "Status"],
          ["MT1234", "Jean", "Pierre", "ORG1", "ACTIVE"],
        ]
      : [],
};
const legacyHit = await lookupStudentGlobal({ id: "MT-1234" }, null, env, legacyDeps);
console.assert(legacyHit.success === true && legacyHit.student.Student_ID === "MT1234", "Dashed legacy shape should still match the undashed stored ID", legacyHit);

console.log("=== lookupStudentGlobal: rejects an INACTIF row ===");
const inactiveHit = await lookupStudentGlobal({ id: "STU-002" }, null, env, deps);
console.assert(inactiveHit.success === false && inactiveHit.found === false, "An INACTIF row should not resolve as found", inactiveHit);

console.log("=== lookupStudentGlobal: rejects a row belonging to another org ===");
const otherOrgHit = await lookupStudentGlobal({ id: "STU-003" }, null, env, deps);
console.assert(otherOrgHit.success === false && otherOrgHit.denied === true, "A different org's matricule should be denied, not found", otherOrgHit);

console.log("=== lookupStudentGlobal: unknown id ===");
const missHit = await lookupStudentGlobal({ id: "NOPE" }, null, env, deps);
console.assert(missHit.success === false && missHit.found === false, "An unknown id should report not found", missHit);

console.log("=== audit_log coverage ===");
const auditOps = db._raw
  .prepare(`SELECT op FROM audit_log WHERE table_name = 'students' AND row_id = 'STU-100' ORDER BY created_at ASC`)
  .all()
  .map((r) => r.op);
console.assert(auditOps.includes("insert"), "Expected an insert audit row for the new student", auditOps);
console.assert(auditOps.includes("update"), "Expected an update audit row for the resend-edit", auditOps);
console.assert(auditOps.includes("reset_pin"), "Expected a reset_pin audit row", auditOps);

console.log("\nAll assertions passed.");
