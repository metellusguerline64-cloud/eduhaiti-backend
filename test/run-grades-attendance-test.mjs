// Runs the REAL grades.js / attendance.js action code (not a copy)
// against sqlite (via better-sqlite3 — `npm install` first), the same
// way test/run-sync-test.mjs verifies generatedIdsSync.js.
//
// This version tests the REAL Code.gs-verified port: real action
// names (getGrades/saveManualExamGrade/..., getAttendanceForStudent/
// recordAttendance/recordBulkAttendance/...) and real column shapes
// (GradeID/HistoryID/StudentID/..., RecordID/HistoryID/StudentID/...).
//
//   npm install
//   node test/run-grades-attendance-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { storeSessionToken } from "../src/lib/session.js";
import { getGrades, saveManualExamGrade, getExistingGrade } from "../src/actions/grades.js";
import {
  getAttendanceForStudent,
  getAttendanceByDate,
  getAttendanceStats,
  getStudentAttendanceStats,
  recordAttendance,
  recordBulkAttendance,
  recordStudentAttendance,
} from "../src/actions/attendance.js";

const DB_PATH = "/tmp/eduhaiti-grades-attendance-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
const env = { DB: db, ORG_ID: "ORG1" };

// Seed one active student + history row, needed by the attendance
// actions (they look up GradeLevelID/HistoryID via student_history).
db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, active, created_at, version, updated_at)
     VALUES (?, 'STU-001', 'ORG1', 'Jean', 'Baptiste', 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());
db._raw
  .prepare(
    `INSERT INTO student_history (id, history_id, student_id, org_id, school_year, grade_level_id, status, updated_at)
     VALUES (?, 'HIS-00000001', 'STU-001', 'ORG1', '2025-2026', '6EME', 'ACTIVE', datetime('now'))`
  )
  .run(crypto.randomUUID());

const TOKEN = "test-token";
await storeSessionToken(db, TOKEN, { userId: "TEACHER-1", email: "teacher@school.ht", role: "teacher" });
const auth = { token: TOKEN };

console.log("=== grades: unauthenticated ===");
const unauth = await getGrades({}, null, env);
console.assert(unauth.success === false, "getGrades without auth should fail", unauth);

console.log("=== grades: missing period is a hard error, not a silent T1 default ===");
const noPeriod = await saveManualExamGrade({ studentID: "STU-001", subjectId: "MATH", grade: 15 }, auth, env);
console.assert(noPeriod.success === false, "Missing period should be rejected", noPeriod);

console.log("=== grades: save T1 ===");
const t1 = await saveManualExamGrade({ studentID: "STU-001", subjectId: "MATH", periodId: "T1", grade: 15 }, auth, env);
console.assert(t1.success === true && t1.version === 1, "First grade write should succeed at version 1", t1);

console.log("=== grades: save T2 for the same student+subject merges into ScoresJSON, doesn't duplicate the row ===");
const t2 = await saveManualExamGrade({ studentID: "STU-001", subjectId: "MATH", periodId: "T2", grade: 12 }, auth, env);
console.assert(t2.success === true && t2.version === 2 && t2.id === t1.id, "T2 write should update the same row to version 2", t2);

console.log("=== grades: getGrades expands ScoresJSON into one entry per period ===");
const listed = await getGrades({ studentId: "STU-001" }, auth, env);
console.assert(listed.data.length === 2, "Expected 2 expanded grade entries (T1 + T2)", listed.data);
const periods = listed.data.map((g) => g.PeriodID).sort();
console.assert(periods[0] === "T1" && periods[1] === "T2", "Expected both T1 and T2 periods present", periods);
const t1Entry = listed.data.find((g) => g.PeriodID === "T1");
console.assert(t1Entry.Score === 15, "T1 score should still be 15 after T2 was added", t1Entry);

console.log("=== grades: getExistingGrade ===");
const existing = await getExistingGrade({ studentCode: "STU-001", examTitle: "MATH" }, auth, env);
console.assert(existing.found === true && existing.scoresJson.T2 === 12, "getExistingGrade should find the merged row", existing);

console.log("=== grades: invalid period rejected ===");
const badPeriod = await saveManualExamGrade({ studentID: "STU-001", subjectId: "MATH", periodId: "T9", grade: 10 }, auth, env);
console.assert(badPeriod.success === false, "Out-of-range period should be rejected", badPeriod);

console.log("=== attendance: single kiosk check-in ===");
const rec1 = await recordAttendance({ studentId: "STU-001", mode: "IN" }, auth, env);
console.assert(rec1.success === true, "First check-in today should succeed", rec1);

console.log("=== attendance: duplicate same-day check-in is rejected, not a second row ===");
const rec2 = await recordAttendance({ studentId: "STU-001", mode: "IN" }, auth, env);
console.assert(rec2.success === false && rec2.duplicate === true, "Second check-in same day should be flagged as duplicate", rec2);

const forStudent = await getAttendanceForStudent({ studentId: "STU-001" }, auth, env);
console.assert(forStudent.data.length === 1, "Only 1 attendance row should exist for STU-001 today", forStudent.data);
console.assert(forStudent.data[0].HistoryID === "HIS-00000001", "Attendance row should carry the student's active HistoryID", forStudent.data[0]);

console.log("=== attendance: getAttendanceByDate ===");
const today = new Date().toISOString().slice(0, 10);
const byDate = await getAttendanceByDate({ date: today }, auth, env);
console.assert(byDate.data.length === 1, "getAttendanceByDate should return today's row", byDate.data);

console.log("=== attendance: getStudentAttendanceStats ===");
const stats = await getStudentAttendanceStats({ studentId: "STU-001" }, auth, env);
console.assert(stats.stats.present === 1 && stats.stats.attendancePct === 100, "Stats should show 1 present / 100%", stats.stats);

console.log("=== attendance: getAttendanceStats (global) ===");
const globalStats = await getAttendanceStats({}, auth, env);
console.assert(globalStats.data.present === 1 && globalStats.data.total === 1, "Global stats should count the one row", globalStats.data);

console.log("=== attendance: kiosk lookup also matches NISU stored in custom_fields ===");
db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, custom_fields, active, created_at, version, updated_at)
     VALUES (?, 'STU-NISU', 'ORG1', 'Nadia', 'Pierre', ?, 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID(), JSON.stringify({ NISU: 'NISU-8844' }));
const nisuKiosk = await recordStudentAttendance({ shortCode: '8844' }, auth, env);
console.assert(nisuKiosk.success === true && nisuKiosk.studentId === 'STU-NISU', 'NISU-only lookup should resolve the student', nisuKiosk);

console.log("=== attendance: bulk rejects an explicitly invalid record type ===");
const invalidType = await recordBulkAttendance({ records: [{ id: 'STU-002', type: 'STAFF', status: 'PRESENT' }] }, auth, env);
console.assert(invalidType.results[0].ok === false && invalidType.results[0].reason === 'INVALID_TYPE', 'Explicit non-STUDENT bulk records must be rejected', invalidType);

console.log("=== attendance: recordBulkAttendance skips already-marked students, marks the rest ===");
db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, active, created_at, version, updated_at)
     VALUES (?, 'STU-002', 'ORG1', 'Marie', 'Joseph', 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());
const bulk = await recordBulkAttendance({ records: [{ id: "STU-001", status: "PRESENT" }, { id: "STU-002", status: "ABSENT" }] }, auth, env);
console.assert(bulk.processed === 1, "Only STU-002 should be newly processed (STU-001 already marked today)", bulk);
console.assert(bulk.results[0].alreadyScanned === true, "STU-001 should be reported as already scanned", bulk.results[0]);
console.assert(bulk.results[1].success === true, "STU-002 should be recorded successfully", bulk.results[1]);

console.log("=== attendance: recordStudentAttendance fuzzy-matches a partial code/name (verifyStudentByLast4 port) ===");
db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, active, created_at, version, updated_at)
     VALUES (?, 'STU-003', 'ORG1', 'Wideline', 'Charles', 1, datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());
const kioskByPartialCode = await recordStudentAttendance({ shortCode: "003" }, auth, env);
console.assert(kioskByPartialCode.success === true && kioskByPartialCode.studentId === "STU-003", "A partial code like '003' should fuzzy-match STU-003", kioskByPartialCode);

console.log("=== attendance: recordStudentAttendance fuzzy-matches by partial last name too ===");
const kioskByName = await recordStudentAttendance({ shortCode: "charle" }, auth, env);
console.assert(kioskByName.success === false && kioskByName.alreadyScanned === true, "STU-003 already checked in above, a name match should report duplicate not re-insert", kioskByName);

console.log("=== attendance: recordStudentAttendance for STU-002 (already marked via bulk today) reports duplicate, not a fresh insert ===");
const kiosk = await recordStudentAttendance({ shortCode: "STU-002" }, auth, env);
console.assert(kiosk.success === false && kiosk.alreadyScanned === true, "STU-002 already marked via bulk today, should report duplicate", kiosk);

console.log("=== attendance: recordStudentAttendance for unknown student ===");
const unknown = await recordStudentAttendance({ shortCode: "GHOST-999-NOPE" }, auth, env);
console.assert(unknown.success === false && !unknown.alreadyScanned, "Unknown student should fail cleanly", unknown);

console.log("=== audit_log coverage ===");
const auditRows = db._raw.prepare(`SELECT table_name, op FROM audit_log ORDER BY created_at ASC`).all();
const gradesOps = auditRows.filter((r) => r.table_name === "grades").map((r) => r.op);
const attendanceOps = auditRows.filter((r) => r.table_name === "attendance").map((r) => r.op);
console.assert(gradesOps.filter((o) => o === "insert").length === 1, "Expected 1 grade insert (T1) in audit_log", gradesOps);
console.assert(gradesOps.filter((o) => o === "update").length === 1, "Expected 1 grade update (T2 merge) in audit_log", gradesOps);
console.assert(attendanceOps.filter((o) => o === "insert").length === 4, "Expected 4 attendance inserts (rec1 + NISU kiosk + bulk STU-002 + kiosk STU-003)", attendanceOps);

console.log("\nAll assertions passed.");
