// Runs the REAL teacher_assignments.js action code (not a copy) against
// sqlite (via node:sqlite), same pattern as run-payments-test.mjs.
//
//   npm install
//   node test/run-teacher-assignments-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { storeSessionToken } from "../src/lib/session.js";
import {
  getStaffAssignments,
  saveStaffAssignment,
  deleteStaffAssignment,
  createSubject,
} from "../src/actions/teacher_assignments.js";

const DB_PATH = "/tmp/eduhaiti-teacher-assignments-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,role,permissions_json,is_teacher,assigned_subjects,is_master,is_god_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
  "U-ADMIN","ADMIN-1","admin@school.ht","Admin School","x","Admin",JSON.stringify({p_staff:true,pa_teacher_affectation:true}),0,"[]",1,0
);
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,role,permissions_json,is_teacher,assigned_subjects,is_master,is_god_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
  "U-MARIE","MARIE-1","marie@school.ht","Marie Dupont","x","Teacher",JSON.stringify({pt_view_class_list:true}),1,"[]",0,0
);
const env = { DB: db, ORG_ID: "ORG1" };

const TOKEN = "test-token";
await storeSessionToken(db, TOKEN, { userId: "ADMIN-1", email: "admin@school.ht", role: "admin" });
const auth = { token: TOKEN };

console.log("=== teacher_assignments: unauthenticated ===");
const unauth = await saveStaffAssignment({ teacher: "Jean", className: "6EME-A" }, null, env);
console.assert(unauth.success === false, "saveStaffAssignment without auth should fail", unauth);

console.log("=== teacher_assignments: requires teacher and className ===");
const missing = await saveStaffAssignment({ teacher: "Jean" }, auth, env);
console.assert(missing.success === false, "Missing className should be rejected", missing);

console.log("=== teacher_assignments: create a new assignment ===");
const created = await saveStaffAssignment(
  {
    teacher: "Marie Dupont",
    teacherId: "marie@school.ht",
    className: "6EME-A",
    subject: "Mathématiques",
    day: "Lundi",
    start: "08:00",
    end: "09:00",
    hours: 5,
    rate: 200,
    payMode: "HOURLY",
  },
  auth,
  env
);
console.assert(created.success === true && created.data.id.startsWith("AFC-"), "Should create with a generated AssignmentID", created);
console.assert(created.data.usersSync.success === true && created.data.usersSync.changed === true, "usersSync should update Marie's Users row", created.data.usersSync);

console.log("=== teacher_assignments: re-saving same composite key updates in place, not duplicated ===");
const resaved = await saveStaffAssignment(
  {
    teacher: "Marie Dupont",
    teacherId: "marie@school.ht",
    className: "6EME-A",
    subject: "Mathématiques",
    day: "Lundi",
    start: "08:00",
    end: "09:00",
    hours: 6,
    rate: 200,
    payMode: "HOURLY",
  },
  auth,
  env
);
console.assert(resaved.data.id === created.data.id, "Composite match should update the same row, same id", resaved);

console.log("=== teacher_assignments: payMode is not overwritten by a blank value ===");
const noModeSent = await saveStaffAssignment(
  { id: created.data.id, teacher: "Marie Dupont", className: "6EME-A", subject: "Mathématiques", day: "Lundi", start: "08:00", end: "09:00", hours: 6, rate: 200 },
  auth,
  env
);
console.assert(noModeSent.success === true, "Save without payMode should still succeed", noModeSent);

console.log("=== teacher_assignments: getStaffAssignments returns full roster to admin ===");
const listed = await getStaffAssignments(null, auth, env);
console.assert(listed.success === true && listed.data.length === 1, "Expected 1 active assignment", listed.data);
console.assert(listed.data[0].payMode === "HOURLY", "PayMode should have been preserved (not blanked by the follow-up save)", listed.data[0]);
console.assert(listed.data[0].hours === 6, "Hours should reflect the latest save", listed.data[0]);

console.log("=== teacher_assignments: AssignedSubjects contains Marie's class ===");
const assignedRow = db._raw.prepare(`SELECT assigned_subjects FROM users WHERE id = 'U-MARIE'`).get();
const assignedClasses = JSON.parse(assignedRow.assigned_subjects || "[]");
console.assert(assignedClasses.some(x => x.className === "6EME-A"), "Marie should receive 6EME-A in AssignedSubjects", assignedClasses);

console.log("=== teacher_assignments: non-admin sees only own rows and no pay fields ===");
const teacherToken = "teacher-token";
await storeSessionToken(db, teacherToken, { userId: "U-MARIE", email: "marie@school.ht", role: "Teacher" });
const teacherAuth = { token: teacherToken };
const teacherListed = await getStaffAssignments(null, teacherAuth, env);
console.assert(teacherListed.success === true && teacherListed.data.length === 1, "Teacher should see only own assignments", teacherListed);
console.assert(!Object.hasOwn(teacherListed.data[0], "rate") && !Object.hasOwn(teacherListed.data[0], "salary") && !Object.hasOwn(teacherListed.data[0], "hours"), "Teacher roster must redact pay fields", teacherListed.data[0]);

console.log("=== teacher_assignments: createSubject aliases saveStaffAssignment ===");
const subj = await createSubject(
  { teacherId: "marie@school.ht", classId: "6EME-A", name: "Sciences", hoursPerWeek: 3, day: "Mardi", startTime: "10:00", endTime: "11:00" },
  auth,
  env
);
console.assert(subj.success === true, "createSubject should succeed", subj);
const listed2 = await getStaffAssignments(null, auth, env);
console.assert(listed2.data.length === 2, "Expected 2 active assignments after createSubject", listed2.data);

console.log("=== teacher_assignments: deleteStaffAssignment soft-deletes (Active=FALSE) ===");
const deleted = await deleteStaffAssignment({ id: created.data.id }, auth, env);
console.assert(deleted.success === true, "Delete should succeed", deleted);
const afterDelete = await getStaffAssignments(null, auth, env);
console.assert(afterDelete.data.length === 1, "Deleted assignment should no longer be listed", afterDelete.data);

console.log("=== teacher_assignments: deleting a non-existent assignment is not an error ===");
const noMatch = await deleteStaffAssignment({ id: "AFC-DOESNOTEXIST" }, auth, env);
console.assert(noMatch.success === true, "Delete with no match should still report success, same as Code.gs", noMatch);

console.log("=== audit_log coverage ===");
const auditRows = db._raw
  .prepare(`SELECT op FROM audit_log WHERE table_name = 'teacher_assignments' ORDER BY created_at ASC`)
  .all();
const ops = auditRows.map((r) => r.op);
console.assert(ops.filter((o) => o === "insert").length === 2, "Expected 2 inserts (Marie's row, Sciences via createSubject)", ops);
console.assert(ops.filter((o) => o === "update").length === 2, "Expected 2 updates (composite re-save, blank-payMode re-save)", ops);
console.assert(ops.filter((o) => o === "delete").length === 1, "Expected 1 delete", ops);

console.log("\nAll assertions passed.");
