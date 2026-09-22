// Runs the REAL payments.js action code (not a copy) against sqlite
// (via better-sqlite3), the same way run-grades-attendance-test.mjs
// verifies grades.js/attendance.js.
//
//   npm install
//   node test/run-payments-test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeD1 } from "./d1shim.mjs";
import { storeSessionToken } from "../src/lib/session.js";
import { getStudentPayments, recordNewPayment, voidPayment, editPayment } from "../src/actions/payments.js";

const DB_PATH = path.join(os.tmpdir(), "eduhaiti-payments-test.sqlite");
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
await storeSessionToken(db, TOKEN, { userId: "CASHIER-1", email: "cashier@school.ht", role: "finance" });
const auth = { token: TOKEN };

console.log("=== payments: unauthenticated ===");
const unauth = await recordNewPayment({ studentId: "STU-001", amountPaid: 100 }, null, env);
console.assert(unauth.success === false, "recordNewPayment without auth should fail", unauth);

console.log("=== payments: invalid amount rejected ===");
const badAmt = await recordNewPayment({ studentId: "STU-001", amountPaid: 0 }, auth, env);
console.assert(badAmt.success === false, "Zero amount should be rejected", badAmt);

console.log("=== payments: full tuition payment (amountDue == amountPaid) is PAID ===");
const full = await recordNewPayment(
  { studentId: "STU-001", amountPaid: 5000, amountDue: 5000, designation: "Scolarité", method: "CASH" },
  auth,
  env
);
console.assert(full.success === true && full.status === "PAID" && full.version === 1, "Full payment should succeed as PAID at version 1", full);
console.assert(full.receiptId && full.receiptId.startsWith("REC-"), "Receipt id should be generated", full);

console.log("=== payments: partial payment is PARTIAL, carries HistoryID from active student_history ===");
const partial = await recordNewPayment(
  { studentId: "STU-001", amountPaid: 1000, amountDue: 3000, designation: "Frais examen" },
  auth,
  env
);
console.assert(partial.success === true && partial.status === "PARTIAL", "Underpayment should be PARTIAL", partial);

console.log("=== payments: getStudentPayments defaults to the active HistoryID, lists both receipts ===");
const listed = await getStudentPayments({ studentId: "STU-001" }, auth, env);
console.assert(listed.success === true && listed.data.length === 2, "Expected 2 payments for STU-001", listed.data);
console.assert(listed.data.every((p) => p.HistoryID === "HIS-00000001"), "Both rows should carry the active HistoryID", listed.data);
console.assert(listed.data.every((p) => p.CashierEmail === "cashier@school.ht"), "CashierEmail should be the authenticated viewer's email", listed.data);

console.log("=== payments: idempotent retry with the same clientRequestId replays, doesn't duplicate ===");
const first = await recordNewPayment(
  { studentId: "STU-001", amountPaid: 500, amountDue: 500, clientRequestId: "CLIENT-ABC" },
  auth,
  env
);
console.assert(first.success === true && !first.idempotentReplay, "First submission should be a real insert", first);
const retry = await recordNewPayment(
  { studentId: "STU-001", amountPaid: 500, amountDue: 500, clientRequestId: "CLIENT-ABC" },
  auth,
  env
);
console.assert(retry.success === true && retry.idempotentReplay === true && retry.receiptId === first.receiptId, "Retried submission should replay the same receipt, not duplicate", retry);
const afterRetryCount = (await getStudentPayments({ studentId: "STU-001", allYears: true }, auth, env)).data.length;
console.assert(afterRetryCount === 3, "Idempotent retry should not have created a 4th row", afterRetryCount);

console.log("=== payments: voidPayment requires a reason ===");
const voidNoReason = await voidPayment({ studentId: "STU-001", receiptId: full.receiptId }, auth, env);
console.assert(voidNoReason.success === false, "Void without a reason should be rejected", voidNoReason);

console.log("=== payments: voidPayment marks VOID, bumps version, is idempotent on a second call ===");
const voided = await voidPayment({ studentId: "STU-001", receiptId: full.receiptId, reason: "Erreur de saisie" }, auth, env);
console.assert(voided.success === true && voided.status === "VOID" && voided.version === 2, "Void should succeed and bump version to 2", voided);
const voidedAgain = await voidPayment({ studentId: "STU-001", receiptId: full.receiptId, reason: "Erreur de saisie" }, auth, env);
console.assert(voidedAgain.success === true && voidedAgain.alreadyVoid === true, "Voiding an already-void payment should report alreadyVoid, not error", voidedAgain);

console.log("=== payments: voidPayment rejects a stale baseVersion (conflict) ===");
const staleVoid = await voidPayment({ studentId: "STU-001", receiptId: partial.receiptId, reason: "test", baseVersion: 99 }, auth, env);
console.assert(staleVoid.success === false && staleVoid.conflict === true, "Stale baseVersion should be rejected as a conflict", staleVoid);

console.log("=== payments: voiding blocks further edits ===");
const editVoided = await editPayment({ studentId: "STU-001", receiptId: full.receiptId, reason: "test", amountPaid: 4000 }, auth, env);
console.assert(editVoided.success === false, "Editing a VOID payment should be rejected", editVoided);

console.log("=== payments: editPayment updates amount/reference, preserves status, bumps version ===");
const edited = await editPayment(
  { studentId: "STU-001", receiptId: partial.receiptId, reason: "Correction montant", amountPaid: 1200, reference: "CHQ-42" },
  auth,
  env
);
console.assert(edited.success === true && edited.amountPaid === 1200 && edited.reference === "CHQ-42" && edited.version === 2, "Edit should apply new amount/reference and bump version", edited);
const afterEdit = await getStudentPayments({ studentId: "STU-001", allYears: true }, auth, env);
const editedRow = afterEdit.data.find((p) => p.ReceiptID === partial.receiptId);
console.assert(editedRow.Status === "PARTIAL", "editPayment must not recompute status automatically", editedRow);

console.log("=== audit_log coverage ===");
const auditRows = db._raw.prepare(`SELECT table_name, op FROM audit_log WHERE table_name = 'payments' ORDER BY created_at ASC`).all();
const ops = auditRows.map((r) => r.op);
console.assert(ops.filter((o) => o === "insert").length === 3, "Expected 3 payment inserts in audit_log (full, partial, first CLIENT-ABC — the retry replays, no new insert)", ops);
console.assert(ops.filter((o) => o === "void").length === 1, "Expected 1 void in audit_log", ops);
console.assert(ops.filter((o) => o === "edit").length === 1, "Expected 1 edit in audit_log", ops);

console.log("\nAll assertions passed.");
