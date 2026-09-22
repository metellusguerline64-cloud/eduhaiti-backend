// Runs the REAL permissions.js code (not a copy) — no D1/sqlite needed,
// this module is pure logic over a viewer object.
//
//   node test/run-permissions-test.mjs

import { checkActionPermission, requiresStrictStudentScope, STRICT_STUDENT_SCOPE_PERMISSION_KEYS } from "../src/lib/permissions.js";

console.log("=== unknown action is rejected outright, even for a privileged viewer ===");
const unknown = checkActionPermission({ isMaster: true }, "thisActionDoesNotExist");
console.assert(unknown.allowed === false && /non reconnue/.test(unknown.error), "Unknown action should be rejected before any permission check", unknown);

console.log("=== isMaster / isGodMode bypass every permission check ===");
const master = checkActionPermission({ isMaster: true, permissions: {} }, "recordNewPayment");
console.assert(master.allowed === true, "isMaster should bypass pa_record_payment requirement", master);
const godMode = checkActionPermission({ isGodMode: true, permissions: {} }, "voidPayment");
console.assert(godMode.allowed === true, "isGodMode should bypass p_approve_payments requirement", godMode);

console.log("=== viewer with NO matching permission is rejected — role alone never satisfies this ===");
// The whole point of the fix: a viewer with role:'Teacher' but an empty
// permissions map must still be rejected — permission is per-action, not
// inferred from the Role label.
const noPerm = checkActionPermission({ role: "Teacher", permissions: {} }, "recordNewPayment");
console.assert(noPerm.allowed === false && noPerm.error.includes("PA_RECORD_PAYMENT"), "A role string alone should not satisfy pa_record_payment", noPerm);

console.log("=== viewer holding the exact required key is allowed ===");
const cashier = checkActionPermission({ role: "Caissier", permissions: { pa_record_payment: true } }, "recordNewPayment");
console.assert(cashier.allowed === true, "pa_record_payment holder should be allowed to recordNewPayment", cashier);

console.log("=== OR-list: any ONE of several accepted keys is enough ===");
// getAllStudents accepts p_dossier/pa_add_student/pa_edit_student OR any
// STRICT_STUDENT_SCOPE_PERMISSION_KEYS_ member — a portal-only teacher
// holding just pt_mark_attendance must still pass (this is the exact
// "entry implies read of your own scope" fix Code.gs's own comment
// describes above this action).
const portalTeacher = checkActionPermission({ permissions: { pt_mark_attendance: true } }, "getAllStudents");
console.assert(portalTeacher.allowed === true, "A pt_mark_attendance-only viewer should still pass getAllStudents' gate", portalTeacher);

console.log("=== empty-string/empty-array policy entries mean any authenticated viewer ===");
const anyViewer = checkActionPermission({ permissions: {} }, "getViewerInfo");
console.assert(anyViewer.allowed === true, "'' policy entries should require no specific permission", anyViewer);
const anyViewer2 = checkActionPermission({ permissions: {} }, "initSheets");
console.assert(anyViewer2.allowed === true, "[] policy entries should require no specific permission", anyViewer2);

console.log("=== requiresStrictStudentScope: true only for portal-key-only viewers ===");
const portalOnly = { permissions: { pt_view_bulletin: true } };
console.assert(requiresStrictStudentScope(portalOnly) === true, "A pt_* -only viewer should be strict-scoped", portalOnly);
const admin = { permissions: { p_dossier: true, pt_view_bulletin: true } };
// Per Code.gs's own bugfix comment (STRICT_STUDENT_SCOPE_PERMISSION_KEYS_
// "single source of truth"): holding a pt_* key still flips strict scope
// on even alongside a broader permission — the scoping decision here is
// deliberately about which KEYS are present, not about picking the
// "most privileged" one. Broader-permission short-circuiting (director
// who also teaches a class) is handled by the caller, same as Code.gs's
// own filterStudentsByViewerScope_ callers do, not inside this helper.
console.assert(requiresStrictStudentScope(admin) === true, "Holding p_dossier alongside a pt_* key still reports strict-scope-eligible", admin);
const masterViewer = { isMaster: true, permissions: { pt_view_bulletin: true } };
console.assert(requiresStrictStudentScope(masterViewer) === false, "isMaster should never be strict-scoped regardless of held keys", masterViewer);
console.assert(STRICT_STUDENT_SCOPE_PERMISSION_KEYS.includes("pt_view_photo") && STRICT_STUDENT_SCOPE_PERMISSION_KEYS.includes("pt_view_contact"), "The historical missing-keys bug (pt_view_photo/pt_view_contact) must stay fixed", STRICT_STUDENT_SCOPE_PERMISSION_KEYS);

console.log("All permissions assertions ran (see any 'Assertion failed' lines above for failures).");
