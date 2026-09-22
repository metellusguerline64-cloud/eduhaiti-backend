// Runs the REAL students.js domain-action code (not a copy) against
// sqlite (via node:sqlite), the same way run-payments-test.mjs verifies
// payments.js.
//
//   npm install
//   node test/run-students-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import {
  getAllStudents,
  getStudentById,
  searchStudents,
  getStudentHistory,
  updateStudent,
  enrollStudent,
  dropStudent,
  reEnrollStudent,
  updateStudentHistory,
} from "../src/actions/students.js";

const DB_PATH = "/tmp/eduhaiti-students-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ACADEMIC_YEAR', '2025-2026')`).run();
const env = { DB: db, ORG_ID: "ORG1" };

db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, phone, active, created_at, version, updated_at)
     VALUES (?, 'STU-001', 'ORG1', 'Jean', 'Baptiste', '5091234567', 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());
db._raw
  .prepare(
    `INSERT INTO student_history (id, history_id, student_id, org_id, school_year, grade_level_id, section, status, updated_at)
     VALUES (?, 'HIS-00000001', 'STU-001', 'ORG1', '2025-2026', '6EME', 'A', 'ACTIVE', datetime('now'))`
  )
  .run(crypto.randomUUID());

db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, active, created_at, version, updated_at)
     VALUES (?, 'STU-002', 'ORG1', 'Marie', 'Joseph', 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());
// STU-002 has no active history — should read back as "Non inscrit".

db._raw
  .prepare(
    `INSERT INTO attendance (id, student_id, org_id, date, status, updated_at)
     VALUES (?, 'STU-001', 'ORG1', '2025-09-10', 'PRESENT', datetime('now')),
            (?, 'STU-001', 'ORG1', '2025-09-11', 'ABSENT', datetime('now'))`
  )
  .run(crypto.randomUUID(), crypto.randomUUID());

console.log("=== students: getAllStudents lists both, with joined active-history fields ===");
const all = await getAllStudents({}, null, env);
console.assert(Array.isArray(all) && all.length === 2, "Expected 2 students", all);
const stu1 = all.find((s) => s.StudentCode === "STU-001");
const stu2 = all.find((s) => s.StudentCode === "STU-002");
console.assert(stu1.Active === "TRUE" && stu1.CurrentLevel === "6EME" && stu1.ActiveHistoryID === "HIS-00000001", "STU-001 should show its active history", stu1);
console.assert(stu2.Active === "FALSE" && stu2.CurrentLevel === "Non inscrit", "STU-002 has no history row, should read as not enrolled", stu2);
console.assert(stu1.attendance === 50, "STU-001 should be 50% present (1 PRESENT / 1 ABSENT)", stu1.attendance);

console.log("=== students: getStudentById ===");
const byId = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(byId.success === true && byId.data.LastName === "Baptiste", "getStudentById should find STU-001", byId);
const missing = await getStudentById({ studentId: "GHOST" }, null, env);
console.assert(missing.success === false, "Unknown student should fail cleanly", missing);

console.log("=== students: searchStudents matches name and code ===");
const byName = await searchStudents({ query: "jean" }, null, env);
console.assert(byName.data.length === 1 && byName.data[0].StudentCode === "STU-001", "Search by first name should match STU-001", byName);
const byCode = await searchStudents({ query: "STU-002" }, null, env);
console.assert(byCode.data.length === 1 && byCode.data[0].StudentCode === "STU-002", "Search by code should match STU-002", byCode);

console.log("=== students: updateStudent patches demographic fields without touching level ===");
const updated = await updateStudent({ studentId: "STU-001", data: { Phone: "5099999999" } }, null, env);
console.assert(updated.success === true, "Demographic update should succeed", updated);
const afterUpdate = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(afterUpdate.data.Phone === "5099999999", "Phone should be updated", afterUpdate.data);
console.assert(afterUpdate.data.CurrentLevel === "6EME", "Level should be untouched by a non-level update", afterUpdate.data);

console.log("=== students: updateStudent with a level/section change patches the ACTIVE history row in place ===");
const classChange = await updateStudent({ studentId: "STU-001", data: { CurrentLevel: "5EME", Section: "B" } }, null, env);
console.assert(classChange.success === true, "Class change should succeed", classChange);
const afterClassChange = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(afterClassChange.data.CurrentLevel === "5EME" && afterClassChange.data.Section === "B", "Level/section should update", afterClassChange.data);
console.assert(afterClassChange.data.ActiveHistoryID === "HIS-00000001", "Same history row should be patched in place, not a new one", afterClassChange.data);
const rawProjection = db._raw.prepare(`SELECT current_level, section FROM students WHERE student_code='STU-001'`).get();
console.assert(rawProjection.current_level === "5EME" && rawProjection.section === "B", "Student row CurrentLevel/Section must stay consistent with history", rawProjection);

console.log("=== students: identity edits follow SYSTEM_ID_MODE ===");
const manualEdit = await updateStudent({ studentId: "STU-001", data: { FirstName: "Jean-Pierre", LastName: "Baptiste-Nouveau" } }, null, env);
console.assert(manualEdit.success === true, "First/last name should remain editable outside locked identity modes", manualEdit);
let manualStudent = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(manualStudent.data.FirstName === "Jean-Pierre" && manualStudent.data.LastName === "Baptiste-Nouveau", "Manual identity edit should persist", manualStudent);
db._raw.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('SYSTEM_ID_MODE','AUTO')`).run();
const lockedEdit = await updateStudent({ studentId: "STU-001", data: { FirstName: "Blocked" } }, null, env);
console.assert(lockedEdit.success === false, "AUTO mode must reject identity-name edits", lockedEdit);
db._raw.prepare(`INSERT OR REPLACE INTO settings (key,value) VALUES ('SYSTEM_ID_MODE','MANUAL')`).run();

console.log("=== students: unknown form fields are retained in CustomFields ===");
const customEdit = await updateStudent({ studentId: "STU-001", data: { NISU: "NISU-12345" } }, null, env);
console.assert(customEdit.success === true, "Unknown student field should be accepted as custom field", customEdit);
manualStudent = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(manualStudent.data.CustomFields.NISU === "NISU-12345", "Unknown field should persist in CustomFields", manualStudent.data);

console.log("=== students: getStudentHistory returns the row with isCurrent ===");
const hist1 = await getStudentHistory({ studentId: "STU-001" }, null, env);
console.assert(hist1.length === 1 && hist1[0].isCurrent === true && hist1[0].level === "5EME", "History should reflect the patched level", hist1);

console.log("=== students: enrollStudent rejects a student who's already ACTIVE ===");
const dupeEnroll = await enrollStudent({ studentId: "STU-001" }, null, env);
console.assert(dupeEnroll.success === false, "Enrolling an already-active student should be rejected", dupeEnroll);

console.log("=== students: enrollStudent for STU-002 (no history yet) succeeds ===");
const freshEnroll = await enrollStudent({ studentId: "STU-002", gradeLevelId: "6EME", section: "A" }, null, env);
console.assert(freshEnroll.success === true && freshEnroll.historyId, "Fresh enrollment should succeed", freshEnroll);
const stu2After = await getStudentById({ studentId: "STU-002" }, null, env);
console.assert(stu2After.data.Active === "TRUE" && stu2After.data.CurrentLevel === "6EME", "STU-002 should now be active", stu2After.data);

console.log("=== students: dropStudent appends a DROPPED row, doesn't touch the ACTIVE one ===");
const dropped = await dropStudent({ studentId: "STU-002", dropReason: "Transfert" }, null, env);
console.assert(dropped.success === true, "Drop should succeed", dropped);
const histAfterDrop = await getStudentHistory({ studentId: "STU-002" }, null, env);
console.assert(histAfterDrop.length === 2, "Drop should append a row, not replace the original (now 2 rows)", histAfterDrop);
const dropRow = histAfterDrop.find((h) => h.status === "DROPPED");
console.assert(dropRow && dropRow.dropReason === "Transfert" && dropRow.isCurrent === false, "Dropped row should carry the reason and not be current", dropRow);
const activeRow = histAfterDrop.find((h) => h.status === "ACTIVE");
console.assert(activeRow && activeRow.level === "6EME", "Original ACTIVE row should be untouched", activeRow);

console.log("=== students: dropStudent again (no ACTIVE row left) is rejected ===");
const dropAgain = await dropStudent({ studentId: "STU-002" }, null, env);
console.assert(dropAgain.success === false, "Dropping a student with no ACTIVE row should be rejected", dropAgain);

console.log("=== students: reEnrollStudent brings STU-002 back ===");
const reEnroll = await reEnrollStudent({ studentId: "STU-002", gradeLevelId: "6EME", section: "A" }, null, env);
console.assert(reEnroll.success === true, "Re-enroll should succeed after a drop", reEnroll);
const stu2Final = await getStudentById({ studentId: "STU-002" }, null, env);
console.assert(stu2Final.data.Active === "TRUE", "STU-002 should be active again after re-enroll", stu2Final.data);

console.log("=== students: reEnrollStudent rejects an already-ACTIVE student ===");
const reEnrollDupe = await reEnrollStudent({ studentId: "STU-002" }, null, env);
console.assert(reEnrollDupe.success === false, "Re-enrolling an already-active student should be rejected", reEnrollDupe);

console.log("=== students: updateStudentHistory patches a specific row by historyId ===");
const histBump = await updateStudentHistory({ historyId: "HIS-00000001", section: "C" }, null, env);
console.assert(histBump.success === true, "updateStudentHistory should succeed", histBump);
const stu1AfterHistBump = await getStudentById({ studentId: "STU-001" }, null, env);
console.assert(stu1AfterHistBump.data.Section === "C", "Section should reflect the direct history patch", stu1AfterHistBump.data);

console.log("=== audit_log coverage ===");
const auditRows = db._raw
  .prepare(`SELECT table_name, op FROM audit_log WHERE table_name IN ('students','student_history') ORDER BY created_at ASC`)
  .all();
const ops = auditRows.map((r) => `${r.table_name}:${r.op}`);
console.assert(ops.includes("students:update"), "Expected a students:update audit row", ops);
console.assert(ops.filter((o) => o === "student_history:enroll").length === 2, "Expected 2 enroll audit rows (STU-002 fresh + re-enroll)", ops);
console.assert(ops.includes("student_history:drop"), "Expected a student_history:drop audit row", ops);
console.assert(ops.includes("student_history:update"), "Expected a student_history:update audit row", ops);

console.log("\nAll assertions passed.");
