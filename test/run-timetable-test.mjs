// Runs the REAL timetable.js action code (not a copy) against sqlite
// (via node:sqlite), same pattern as run-payments-test.mjs.
//
//   npm install
//   node test/run-timetable-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { storeSessionToken } from "../src/lib/session.js";
import { getTimetableData, saveTimetableData } from "../src/actions/timetable.js";

const DB_PATH = "/tmp/eduhaiti-timetable-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
const env = { DB: db, ORG_ID: "ORG1" };

db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,role,permissions_json,is_master,is_god_mode,active) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
  'ADMIN-1','ADMIN-1','admin@school.ht','Admin','x','ADMIN','{}',1,0,1
);

const TOKEN = "test-token";
await storeSessionToken(db, TOKEN, { userId: "ADMIN-1", email: "admin@school.ht", role: "admin" });
const auth = { token: TOKEN };

console.log("=== timetable: unauthenticated ===");
const unauth = await getTimetableData(null, null, env);
console.assert(unauth.success === false, "getTimetableData without auth should fail", unauth);

console.log("=== timetable: empty timetable returns [] ===");
const empty = await getTimetableData(null, auth, env);
console.assert(empty.success === true && empty.data.length === 0, "Expected an empty timetable initially", empty);

console.log("=== timetable: save a full timetable (array payload) ===");
const slotsA = [
  { className: "6EME-A", dayIndex: 1, dayLabel: "Lundi", startTime: "08:00", endTime: "09:00", subject: "Maths", teacher: "Marie", teacherId: "marie@school.ht" },
  { className: "6EME-A", dayIndex: 1, dayLabel: "Lundi", startTime: "09:00", endTime: "10:00", subject: "Français", teacher: "Paul", teacherId: "paul@school.ht" },
];
const savedA = await saveTimetableData(slotsA, auth, env);
console.assert(savedA.success === true && savedA.data.length === 2, "Should save 2 slots", savedA);
console.assert(savedA.data.every((s) => String(s.id).startsWith("TT-")), "Each slot should get a generated SlotID", savedA.data);

console.log("=== timetable: getTimetableData reflects the save, ordered by day/time ===");
const afterA = await getTimetableData(null, auth, env);
console.assert(afterA.data.length === 2, "Expected 2 slots after save", afterA.data);
console.assert(afterA.data[0].startTime === "08:00" && afterA.data[1].startTime === "09:00", "Slots should be ordered by start time", afterA.data);

console.log("=== timetable: re-saving with a subset REPLACES the rest (old slots disappear) ===");
const keepId = savedA.data[0].id;
const slotsB = [
  { id: keepId, className: "6EME-A", dayIndex: 1, dayLabel: "Lundi", startTime: "08:00", endTime: "09:00", subject: "Maths", teacher: "Marie", teacherId: "marie@school.ht" },
  { className: "6EME-B", dayIndex: 2, dayLabel: "Mardi", startTime: "10:00", endTime: "11:00", subject: "Sciences", teacher: "Jean", teacherId: "jean@school.ht" },
];
const savedB = await saveTimetableData(slotsB, auth, env);
console.assert(savedB.success === true && savedB.data.length === 2, "Should save 2 slots again", savedB);
const afterB = await getTimetableData(null, auth, env);
console.assert(afterB.data.length === 2, "Expected exactly 2 active slots after replace", afterB.data);
console.assert(afterB.data.some((s) => s.id === keepId), "The kept slot should still be present with the same id", afterB.data);
console.assert(!afterB.data.some((s) => s.subject === "Français"), "The Français slot should have been soft-deleted, not carried forward", afterB.data);
console.assert(afterB.data.some((s) => s.subject === "Sciences"), "The new Sciences slot should be present", afterB.data);

console.log("=== timetable: the kept slot's version bumped, the soft-deleted one has deleted_at set ===");
const keptRow = db._raw.prepare(`SELECT version FROM timetable WHERE id = ?`).get(keepId);
console.assert(Number(keptRow.version) === 2, "Kept slot should be at version 2 (created, then re-saved)", keptRow);
const removedRow = db._raw.prepare(`SELECT deleted_at FROM timetable WHERE subject = 'Français'`).get();
console.assert(!!removedRow.deleted_at, "Removed slot should have deleted_at set (tombstone), not be hard-deleted", removedRow);

console.log("=== timetable: saving an empty payload clears everything ===");
const cleared = await saveTimetableData([], auth, env);
console.assert(cleared.success === true && cleared.data.length === 0, "Empty save should clear and return []", cleared);
const afterClear = await getTimetableData(null, auth, env);
console.assert(afterClear.data.length === 0, "No active slots should remain after an empty save", afterClear.data);

console.log("=== audit_log coverage ===");
const auditRows = db._raw
  .prepare(`SELECT op FROM audit_log WHERE table_name = 'timetable' ORDER BY created_at ASC`)
  .all();
const ops = auditRows.map((r) => r.op);
console.assert(ops.filter((o) => o === "update").length === 2, "Expected 2 'update' audit rows (the two non-empty saves)", ops);
console.assert(ops.filter((o) => o === "delete").length === 1, "Expected 1 'delete' audit row (the empty-payload clear)", ops);

console.log("\nAll assertions passed.");
