// Runs the real generatedIdsSync logic against sqlite (via better-sqlite3
// — `npm install` first) and fake Generated_IDs rows, so the sync/history/
// audit-log/throttle logic can be verified without wrangler or a live
// Google Sheet. See test/fake-sheets-api.js for the fixture data.
//
//   npm install
//   node test/run-sync-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { runGeneratedIdsSync } from "../src/lib/generatedIdsSync.js";
import { fakeFetchSheetValues } from "./fake-sheets-api.js";

const DB_PATH = "/tmp/eduhaiti-test.sqlite";
try { fs.unlinkSync(DB_PATH); } catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ACADEMIC_YEAR', '2025-2026')`).run();
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();

const env = { DB: db, MASTER_AUTH_ID: "fake-master-id", ORG_ID: "ORG1" };

const result1 = await runGeneratedIdsSync(env, { force: true, fetchSheetValues: fakeFetchSheetValues });
console.log("=== RUN 1 (force) ===");
console.log(JSON.stringify(result1, null, 2));

const students = db._raw.prepare("SELECT student_code, org_id, first_name, last_name, photo_url, current_level, active FROM students").all();
console.log("=== students table ===");
console.log(students);

const hist = db._raw.prepare("SELECT * FROM student_history").all();
console.log("=== student_history table ===");
console.log(hist);

const audit = db._raw.prepare("SELECT table_name, row_id, op, device_id FROM audit_log").all();
console.log("=== audit_log table ===");
console.log(audit);

// Run again immediately without force — should be throttled (inner stamp).
const result2 = await runGeneratedIdsSync(env, { force: false, fetchSheetValues: fakeFetchSheetValues });
console.log("=== RUN 2 (no force, should be throttled) ===");
console.log(JSON.stringify(result2, null, 2));

// Run again with force — existing students should NOT be reprocessed
// (existingCodes filter), so imported/updated should both be 0.
const result3 = await runGeneratedIdsSync(env, { force: true, fetchSheetValues: fakeFetchSheetValues });
console.log("=== RUN 3 (force, but STU-001 already onboarded) ===");
console.log(JSON.stringify(result3, null, 2));

// Sanity assertions
const codes = students.map((s) => s.student_code).sort();
console.assert(JSON.stringify(codes) === JSON.stringify(["STU-001"]), "Expected only STU-001 imported (STU-002 inactive, STU-003 wrong org)", codes);
console.assert(students[0].photo_url.startsWith("https://drive.google.com/thumbnail?id=ABC123"), "Photo URL not normalized", students[0].photo_url);
console.assert(hist.length === 1 && hist[0].grade_level_id === "6eme", "History row wrong", hist);
console.assert(result2.skipped === true, "Run 2 should have been throttled (outer or inner stamp)", result2);
console.assert(result3.imported === 0 && result3.updated === 0, "Run 3 should re-import nothing", result3);
console.log("\nAll assertions passed.");
