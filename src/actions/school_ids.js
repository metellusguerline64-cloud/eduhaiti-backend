import { assertStudentAccess, loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";

function schoolCodeVariants(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return [];
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (!compact) return [];
  const variants = new Set([compact]);
  const noPrefix = compact.replace(/^[A-Z]+/, "");
  if (noPrefix) variants.add(noPrefix);
  return [...variants];
}

function schoolCodesMatch(a, b) {
  const left = schoolCodeVariants(a);
  const right = new Set(schoolCodeVariants(b));
  return left.some((v) => right.has(v));
}

export async function getMySchoolId(data, auth, env) {
  const studentId = String(data?.studentId || data?.id || "").trim();
  if (!studentId) return { success: false, error: "Identifiant élève manquant." };

  try {
    const orgId = await resolveOrgId(env);
    const { results: students = [] } = await env.DB.prepare(
      `SELECT student_code FROM students WHERE org_id = ? AND deleted_at IS NULL`
    ).bind(orgId).all();
    const student = students.find((row) => schoolCodesMatch(row.student_code, studentId));
    const access = await assertStudentAccess(env, auth, orgId, student?.student_code || studentId);
    if (!access.allowed) return { success: false, error: access.error };

    const { results = [] } = await env.DB.prepare(
      `SELECT student_code, school_id, tracking_number, class_name, photo_url, status
         FROM school_ids
        WHERE org_id = ? AND deleted_at IS NULL`
    ).bind(orgId).all();
    const match = results.find((row) => schoolCodesMatch(row.student_code || row.tracking_number, student?.student_code || studentId));
    if (!match) return { success: true, found: false };

    return {
      success: true,
      found: true,
      schoolId: match.school_id,
      trackingNumber: match.tracking_number,
      className: match.class_name,
      photoUrl: match.photo_url,
      status: match.status,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const HEADERS = ["Student Code", "School ID", "Class", "Date", "Json: Student infos", "Status", "Tracking Number", "Form URL", "Photo URL", "Photo Quality", "Mode", "Updated At"];

function canManage(viewer) {
  return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_dossier || viewer.permissions?.pa_add_student || viewer.permissions?.pa_edit_student || viewer.permissions?.p_settings));
}

function normalizeRecord(input) {
  const source = input?.record && typeof input.record === "object" ? input.record : input || {};
  let values = source.values || source.studentInfos || source.studentInfo || source["Json: Student infos"] || {};
  if (typeof values === "string") { try { values = JSON.parse(values); } catch { values = { raw: values }; } }
  const studentCode = String(source["Student Code"] || source.studentCode || source["Tracking Number"] || source.trackingNumber || "").trim();
  const schoolId = String(source["School ID"] || source.schoolId || source.generatedId || source.id || "").trim();
  const tracking = String(source["Tracking Number"] || source.trackingNumber || studentCode || schoolId).trim();
  return {
    studentCode: studentCode || tracking || schoolId,
    schoolId,
    className: String(source.Class || source.className || source.class || "").trim(),
    date: String(source.Date || source.date || new Date().toISOString()).trim(),
    studentInfos: JSON.stringify(values || {}),
    status: String(source.Status || source.status || "CREATED").trim() || "CREATED",
    trackingNumber: tracking,
    formUrl: String(source["Form URL"] || source.formUrl || "").trim(),
    photoUrl: String(source["Photo URL"] || source.photoUrl || source.photo || "").trim(),
    photoQuality: typeof source["Photo Quality"] === "object" ? JSON.stringify(source["Photo Quality"]) : String(source["Photo Quality"] || source.photoQuality || "").trim(),
    mode: String(source.Mode || source.mode || "").trim(),
  };
}

function publicRecord(row) {
  let values = {};
  try { values = JSON.parse(row.student_infos || "{}"); } catch {}
  return {
    "Student Code": row.student_code,
    "School ID": row.school_id,
    Class: row.class_name,
    Date: row.date_value,
    "Json: Student infos": row.student_infos,
    Status: row.status,
    "Tracking Number": row.tracking_number,
    "Form URL": row.form_url,
    "Photo URL": row.photo_url,
    "Photo Quality": row.photo_quality,
    Mode: row.mode,
    "Updated At": row.updated_at,
    studentCode: row.student_code,
    generatedId: row.school_id,
    trackingNumber: row.tracking_number,
    className: row.class_name,
    formUrl: row.form_url,
    photoUrl: row.photo_url,
    photoQuality: row.photo_quality,
    status: row.status,
    mode: row.mode,
    date: row.date_value,
    updatedAt: row.updated_at,
    values,
  };
}

async function adminContext(auth, env) {
  const viewer = auth?.token ? await loadViewer(env, auth) : null;
  if (!viewer) return { error: "Session invalide." };
  if (!canManage(viewer)) return { error: "Droits insuffisants." };
  return { viewer, orgId: await resolveOrgId(env) };
}

export async function getSchoolIdsRecords(_data, auth, env) {
  try {
    const ctx = await adminContext(auth, env); if (ctx.error) return { success: false, error: ctx.error };
    const { results = [] } = await env.DB.prepare(`SELECT * FROM school_ids WHERE org_id=? AND deleted_at IS NULL ORDER BY updated_at DESC`).bind(ctx.orgId).all();
    const records = results.map(publicRecord);
    return { success: true, data: records, records, sheetName: "School IDs", spreadsheetId: null, headers: HEADERS };
  } catch (error) { return { success: false, error: error.message }; }
}

export const getSchoolIds = getSchoolIdsRecords;
export const listSchoolIds = getSchoolIdsRecords;

export async function upsertSchoolIdRecord(data, auth, env) {
  try {
    const ctx = await adminContext(auth, env); if (ctx.error) return { success: false, error: ctx.error };
    const record = normalizeRecord(data);
    if (!record.schoolId) return { success: false, error: "School ID requis." };
    const { results: candidates = [] } = await env.DB.prepare(`SELECT id,student_code,tracking_number,school_id FROM school_ids WHERE org_id=? AND deleted_at IS NULL`).bind(ctx.orgId).all();
    // Match exactly the legacy upsertSchoolIdRecord_ rules:
    // - when Student Code is present, match an existing Student Code or
    //   Tracking Number against the incoming Student Code/Tracking Number;
    // - when both are absent, fall back to School ID.
    const incomingStudentOrTracking = record.studentCode || record.trackingNumber;
    const hasStudentOrTracking = !!incomingStudentOrTracking;
    const existing = candidates.find((candidate) => {
      if (hasStudentOrTracking) {
        return (candidate.student_code && schoolCodesMatch(candidate.student_code, incomingStudentOrTracking)) ||
               (candidate.tracking_number && record.trackingNumber && schoolCodesMatch(candidate.tracking_number, record.trackingNumber));
      }
      return !!(candidate.school_id && record.schoolId && schoolCodesMatch(candidate.school_id, record.schoolId));
    });
    const updatedAt = new Date().toISOString();
    let id = existing?.id;
    if (existing) {
      await env.DB.prepare(`UPDATE school_ids SET student_code=?,school_id=?,class_name=?,date_value=?,student_infos=?,status=?,tracking_number=?,form_url=?,photo_url=?,photo_quality=?,mode=?,updated_at=? WHERE id=?`)
        .bind(record.studentCode, record.schoolId, record.className, record.date, record.studentInfos, record.status, record.trackingNumber, record.formUrl, record.photoUrl, record.photoQuality, record.mode, updatedAt, id).run();
    } else {
      id = `SID-${crypto.randomUUID()}`;
      await env.DB.prepare(`INSERT INTO school_ids(id,org_id,student_code,school_id,class_name,date_value,student_infos,status,tracking_number,form_url,photo_url,photo_quality,mode,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`)
        .bind(id, ctx.orgId, record.studentCode, record.schoolId, record.className, record.date, record.studentInfos, record.status, record.trackingNumber, record.formUrl, record.photoUrl, record.photoQuality, record.mode, updatedAt).run();
    }
    await writeAudit(env.DB, { table: "school_ids", rowId: id, userId: ctx.viewer.id, op: existing ? "update" : "insert", diff: { studentCode: record.studentCode, schoolId: record.schoolId, channel: "D1" } });
    const row = await env.DB.prepare(`SELECT * FROM school_ids WHERE id=?`).bind(id).first();
    // D1 has no Sheets row number, but expose a deterministic 1-based row
    // position for legacy callers that still read `row`.
    let rowNumber = 1;
    if (existing) {
      const position = candidates.findIndex((c) => c.id === existing.id);
      rowNumber = position >= 0 ? position + 2 : 2;
    } else {
      rowNumber = candidates.length + 2;
    }
    return { success: true, row: rowNumber, record: publicRecord(row), sheetName: "School IDs", spreadsheetId: null, message: existing ? "Record mis à jour." : "Record ajouté." };
  } catch (error) { return { success: false, error: error.message }; }
}

export const saveSchoolIdRecord = upsertSchoolIdRecord;
export const appendSchoolIdRecord = upsertSchoolIdRecord;
export const updateSchoolIdRecord = upsertSchoolIdRecord;