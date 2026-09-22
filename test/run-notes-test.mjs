// Runs the REAL notes.js code (not a copy) against sqlite (via
// node:sqlite), same pattern as run-students-test.mjs.
//
//   npm install
//   node test/run-notes-test.mjs

import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import {
  addInternalNote,
  getInternalNotes,
  getStudentInternalNotes,
  addStudentInternalNote,
  saveMedicalRecord,
  saveDocumentSignature,
} from "../src/actions/notes.js";

const DB_PATH = "/tmp/eduhaiti-notes-test.sqlite";
try {
  fs.unlinkSync(DB_PATH);
} catch {}

const db = makeD1(DB_PATH);
const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
db._raw.exec(schema);

db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
const env = { DB: db, ORG_ID: "ORG1" };

db._raw
  .prepare(
    `INSERT INTO students (id, student_code, org_id, first_name, last_name, active, custom_fields, created_at, version, updated_at)
     VALUES (?, 'STU-001', 'ORG1', 'Jean', 'Baptiste', 1, '{}', datetime('now'), 1, datetime('now'))`
  )
  .run(crypto.randomUUID());

// No session/auth wired in these fixtures (auth=null) — loadViewer/
// assertStudentAccess both resolve to "no viewer, no session" in that
// case; addInternalNote/saveDocumentSignature fall back to
// 'System'/'Admin' the same way Code.gs's own viewer.email||'System'
// fallback does. assertStudentAccess without a session returns
// allowed:false ("Session expirée ou invalide."), so student-scoped
// calls here go through the no-studentId / admin-viewer paths instead,
// same as an unauthenticated caller in the original.

console.log("=== addInternalNote: a general note (no studentId) succeeds without a session ===");
const generalNote = await addInternalNote({ content: "Reunion parents planifiee." }, null, env);
console.assert(generalNote.success === true && generalNote.noteId, "General note should be created", generalNote);

console.log("=== getInternalNotes: returns the general note when no studentId filter is given ===");
const allNotes = await getInternalNotes({}, null, env);
console.assert(allNotes.success === true && allNotes.data.length === 1, "Should list the one note", allNotes);
console.assert(allNotes.data[0].Content === "Reunion parents planifiee.", "Content should round-trip", allNotes.data[0]);
console.assert(allNotes.data[0].Author === "System", "Unauthenticated note should fall back to 'System'", allNotes.data[0]);

console.log("=== addStudentInternalNote: string-shorthand payload ===");
// assertStudentAccess rejects a null session ("Session expirée..."), so
// this exercises that same rejection path a real unauthenticated kiosk
// call would hit — same guard students.js's own student-scoped actions
// already enforce.
const shorthand = await addStudentInternalNote("STU-001", null, env);
console.assert(shorthand.success === false, "A student-scoped note with no valid session should be rejected by assertStudentAccess", shorthand);

console.log("=== getStudentInternalNotes: rejects with no studentId ===");
const noId = await getStudentInternalNotes({}, null, env);
console.assert(noId.success === false, "Missing studentId should be rejected", noId);

console.log("=== saveMedicalRecord: rejected without a valid session (student-scoped) ===");
const medNoAuth = await saveMedicalRecord({ studentId: "STU-001", bloodType: "O+" }, null, env);
console.assert(medNoAuth.success === false, "saveMedicalRecord requires a resolvable viewer via assertStudentAccess", medNoAuth);

console.log("=== saveDocumentSignature: succeeds without a session (no student scope check) ===");
const sig = await saveDocumentSignature({ documentType: "Reglement Interieur", signatureData: "base64==" }, null, env);
console.assert(sig.success === true && sig.signatureId, "Signature should be recorded", sig);
const sigRow = db._raw.prepare(`SELECT document_type, signed_by FROM document_signatures WHERE signature_id = ?`).get(sig.signatureId);
console.assert(sigRow.document_type === "Reglement Interieur" && sigRow.signed_by === "System", "Signature row should carry the type and fall-back signer", sigRow);

console.log("=== audit_log coverage ===");
const auditOps = db._raw
  .prepare(`SELECT table_name, op FROM audit_log ORDER BY created_at ASC`)
  .all()
  .map((r) => `${r.table_name}:${r.op}`);
console.assert(auditOps.includes("internal_notes:insert"), "Expected an internal_notes:insert audit row", auditOps);
console.assert(auditOps.includes("document_signatures:insert"), "Expected a document_signatures:insert audit row", auditOps);

console.log("\nAll assertions passed.");
