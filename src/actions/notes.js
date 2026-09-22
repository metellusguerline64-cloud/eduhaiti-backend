// Port of Code.gs's internal-notes / medical-record / document-signature
// actions — a small "student file annex" domain, separate from the
// directory/lifecycle actions in students.js:
//   - addInternalNote_          → addInternalNote          (Code.gs ~line 8752)
//   - getInternalNotes_         → getInternalNotes         (Code.gs ~line 8769)
//   - getStudentInternalNotes_  → getStudentInternalNotes  (Code.gs ~line 10294, thin alias)
//   - addStudentInternalNote_   → addStudentInternalNote   (Code.gs ~line 10307, thin alias)
//   - saveMedicalRecord_        → saveMedicalRecord        (Code.gs ~line 16020)
//   - saveDocumentSignature_    → saveDocumentSignature    (Code.gs ~line 16043)
//
// New D1 tables: `internal_notes`, `document_signatures`
// (migrations/0020_internal_notes_document_signatures.sql) — real
// columns matching Code.gs's SHEET_DEFS entry for 'internal_notes'
// (NoteID/StudentID/Content/Author/AuthorRole/CreatedAt/MetaJSON) and
// the ad hoc 'document_signatures' sheet saveDocumentSignature_ lazily
// creates on first use in the original (SignatureID/StudentID/
// DocumentType/SignatureData/SignedAt/SignedBy).
//
// Medical records are NOT a new table — saveMedicalRecord_ itself never
// had one, it merges a `medical` key into the student's own
// CustomFields JSON, so this port merges into students.custom_fields
// the same way.
//
// Deliberately NOT ported: Code.gs's ensureViewerCanAccessStudentScope_
// is called with the raw `auth` object in getInternalNotes_/
// addInternalNote_ rather than a resolved viewer — this port always
// resolves through assertStudentAccess/loadViewer instead (the same
// substitution every other domain in this project already makes; see
// students.js's own header for the general note on this).

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { loadViewer, assertStudentAccess } from "../lib/accessScope.js";

function resolveStudentId(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload.trim();
  return String(payload.studentId || payload.id || "").trim();
}

// {action: "addInternalNote", data: {studentId?, content, visibility?, historyId?}}
// A note with no studentId is a general/admin note, same as an empty
// StudentID cell in the original — still recorded, not rejected.
export async function addInternalNote(payload, auth, env) {
  try {
    const data = payload || {};
    const studentId = resolveStudentId(data);
    const orgId = await resolveOrgId(env);

    let viewer;
    if (studentId) {
      const guard = await assertStudentAccess(env, auth, orgId, studentId);
      if (!guard.allowed) return { success: false, error: guard.error };
      viewer = guard.viewer;
    } else {
      viewer = await loadViewer(env, auth);
    }

    const noteId = "NOTE-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const meta = { visibility: data.visibility || "Admin", historyId: data.historyId || "" };
    const ts = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO internal_notes (id, note_id, org_id, student_id, content, author, author_role, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(), noteId, orgId, studentId || null, data.content || "",
        (viewer && viewer.email) || "System", (viewer && viewer.role) || "Admin",
        JSON.stringify(meta), ts, ts
      )
      .run();

    await writeAudit(env.DB, {
      table: "internal_notes",
      rowId: noteId,
      userId: viewer && viewer.id,
      deviceId: data.deviceId,
      op: "insert",
      diff: { studentId: studentId || null },
    });

    return { success: true, noteId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "getInternalNotes", data: {studentId?}} — {success, data:[]}.
// No studentId means every note for the org (same as the original —
// gated by the caller's own ACTION_PERMISSIONS entry, not by scope,
// same as Code.gs never scope-checked this branch either).
export async function getInternalNotes(payload, auth, env) {
  try {
    const studentId = resolveStudentId(payload);
    const orgId = await resolveOrgId(env);
    if (studentId) {
      const guard = await assertStudentAccess(env, auth, orgId, studentId);
      if (!guard.allowed) return { success: false, error: guard.error };
    }

    const where = studentId ? "AND student_id = ?" : "";
    const params = studentId ? [orgId, studentId] : [orgId];
    const { results } = await env.DB.prepare(
      `SELECT note_id, student_id, content, author, author_role, meta_json, created_at
       FROM internal_notes WHERE org_id = ? AND deleted_at IS NULL ${where}
       ORDER BY created_at DESC`
    )
      .bind(...params)
      .all();

    return {
      success: true,
      data: (results || []).map((r) => {
        let meta = {};
        try {
          meta = JSON.parse(r.meta_json || "{}");
        } catch {
          meta = {};
        }
        return {
          NoteID: r.note_id,
          StudentID: r.student_id || "",
          Content: r.content,
          Author: r.author,
          AuthorRole: r.author_role,
          CreatedAt: r.created_at,
          MetaJSON: meta,
        };
      }),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "getStudentInternalNotes", data: studentId|{studentId}} — thin
// alias, same as getStudentInternalNotes_.
export async function getStudentInternalNotes(payload, auth, env) {
  const sid = resolveStudentId(payload);
  if (!sid) return { success: false, error: "studentId manquant." };
  return getInternalNotes({ studentId: sid }, auth, env);
}

// {action: "addStudentInternalNote", data: studentId|{studentId,...}} —
// thin alias, same as addStudentInternalNote_.
export async function addStudentInternalNote(payload, auth, env) {
  if (!payload) return { success: false, error: "Payload manquant." };
  const p = typeof payload === "string" ? { studentId: payload } : payload;
  return addInternalNote(p, auth, env);
}

// {action: "saveMedicalRecord", data: {studentId, bloodType?, allergies?, conditions?, medications?, notes?}}
// Merges into students.custom_fields.medical — no separate table, same
// as the original's own CustomFields.medical convention.
export async function saveMedicalRecord(payload, auth, env) {
  try {
    const data = payload || {};
    const studentId = resolveStudentId(data);
    if (!studentId) return { success: false, error: "studentId manquant." };
    const orgId = await resolveOrgId(env);
    const guard = await assertStudentAccess(env, auth, orgId, studentId);
    if (!guard.allowed) return { success: false, error: guard.error };

    const row = await env.DB.prepare(
      `SELECT custom_fields FROM students WHERE org_id = ? AND student_code = ? AND deleted_at IS NULL`
    )
      .bind(orgId, studentId)
      .first();
    if (!row) return { success: false, error: "Eleve introuvable." };

    let cf = {};
    try {
      cf = JSON.parse(row.custom_fields || "{}");
    } catch {
      cf = {};
    }
    cf.medical = {
      bloodType: data.bloodType || "",
      allergies: data.allergies || "",
      conditions: data.conditions || "",
      medications: data.medications || "",
      notes: data.notes || "",
      updatedAt: new Date().toISOString(),
    };

    const ts = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE students SET custom_fields = ?, version = version + 1, updated_at = ? WHERE org_id = ? AND student_code = ?`
    )
      .bind(JSON.stringify(cf), ts, orgId, studentId)
      .run();

    await writeAudit(env.DB, {
      table: "students",
      rowId: studentId,
      userId: guard.viewer && guard.viewer.id,
      deviceId: data.deviceId,
      op: "medical_update",
      diff: { message: "updated" },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "saveDocumentSignature", data: {studentId?, documentType?, signatureData?}}
// No studentId is allowed (a policy-acknowledgment signature not tied
// to one student is a valid case in Code.gs too, since it never
// requires the field).
export async function saveDocumentSignature(payload, auth, env) {
  try {
    const data = payload || {};
    const orgId = await resolveOrgId(env);
    const viewer = await loadViewer(env, auth);
    const signatureId = "SIG-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const ts = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO document_signatures (id, signature_id, org_id, student_id, document_type, signature_data, signed_by, signed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(), signatureId, orgId, resolveStudentId(data) || null,
        data.documentType || "General", data.signatureData || "",
        (viewer && viewer.email) || "System", ts, ts
      )
      .run();

    await writeAudit(env.DB, {
      table: "document_signatures",
      rowId: signatureId,
      userId: viewer && viewer.id,
      deviceId: data.deviceId,
      op: "insert",
      diff: { documentType: data.documentType || "General" },
    });

    return { success: true, signatureId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
