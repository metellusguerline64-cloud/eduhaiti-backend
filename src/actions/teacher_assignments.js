// teacher_assignments.js — REAL port of Code.gs's staff-affectation CRUD,
// verified with Code.gs in context. Real Sheet: 'teacher_assignments',
// headers AssignmentID/TeacherName/TeacherID/ClassName/ClassID/Subject/
// Day/StartTime/EndTime/Hours/Rate/Salary/HasConflict/PaymentMode/
// Active/CreatedAt/UpdatedAt/MetaJSON (Code.gs
// ensureTeacherAssignmentsSheetStructure_). Ported functions:
//   - getStaffAssignments_    → getStaffAssignments     (Code.gs ~line 24224)
//   - saveStaffAssignment_    → saveStaffAssignment      (Code.gs ~line 24532)
//   - deleteStaffAssignment_  → deleteStaffAssignment    (Code.gs ~line 24623)
//   - createSubject_/deleteSubject_ → thin aliases, same as Code.gs itself
//     (createSubject_ ~line 24685 just calls saveStaffAssignment_ with a
//     remapped field, deleteSubject_ ~line 24704 just calls
//     deleteStaffAssignment_ directly).
//
// Previously flagged but now implemented: admin-vs-non-admin response redaction in getStaffAssignments_ (the
//     "only admins/master/godmode see every teacher's hours/rate/salary;
//     a pt_* portal-permission holder sees only their own rows, pay
//     fields stripped" branch). This D1 port's getViewerInfo (auth.js)
//     doesn't resolve permissions/isMaster/isGodMode yet, so there is no
//     signal to redact on — every authenticated caller currently gets
//     the full, unredacted list, same gap already flagged in
//     grades.js/attendance.js/payments.js for viewer scoping generally.
//     Do not expose this action to non-admin callers until that lands.
//   - _autoRepairTeacherAssignmentIdsOnce_ / repairTeacherAssignmentIds_ —
//     the one-time TeacherID backfill for rows saved before TeacherID
//     was populated with a real email/userId. Not relevant to a fresh D1
//     deployment (every row here already has whatever TeacherID the
//     caller sent), so this is a no-op to port, not a gap.
//   - _invalidateTeacherAffectationCaches_ / the whole CacheService-based
//     VIEWER_*/TEACHER_AFFECTATION_ROWS_* invalidation dance — this only
//     existed to work around CacheService's staleness; D1 reads are live,
//     so there is nothing to invalidate.
//   - calculateTeacherPayroll_ / saveTeacherPaymentMode_ / the Payroll
//     sheet — full payroll computation depends on staff clock-in/out
//     attendance (a different, unported sheet/table:
//     `_getTeacherAttendanceMapInRange_` reads 'staff_attendance', not
//     the student `attendance` table this D1 schema has) and on
//     _mergeGeneralStaffIntoPayroll_ reading Users.PayMode/PayRate/
//     PayFixedSalary (also not in the D1 `users` table yet). Porting the
//     assignment CRUD first (this file) is a prerequisite for payroll,
//     not a substitute for it — payroll itself is a separate, larger
//     follow-up port, not attempted here.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { loadSessionToken } from "../lib/session.js";
import { loadViewer } from "../lib/accessScope.js";

function authError() {
  return { success: false, error: "Non authentifié." };
}

async function currentViewer(env, auth) {
  if (!auth || !auth.token) return null;
  const session = await loadSessionToken(env.DB, auth.token);
  if (!session) return null;
  return { userId: session.userId || session.email || null, email: session.email || "" };
}

function nowIso() {
  return new Date().toISOString();
}

function generateAssignmentId() {
  return "AFC-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function assignmentRowToApi(r) {
  let meta = {};
  try {
    meta = JSON.parse(r.meta_json || "{}");
  } catch {
    meta = {};
  }
  return {
    id: r.id,
    teacher: r.teacher_name,
    teacherId: r.teacher_id,
    className: r.class_name,
    classId: r.class_id,
    subject: r.subject,
    day: r.day,
    start: r.start_time,
    end: r.end_time,
    hours: r.hours,
    rate: r.rate,
    salary: r.salary,
    payMode: r.payment_mode || "",
    hasConflict: Number(r.has_conflict) === 1,
    _meta: meta,
    _backendId: r.id,
    version: r.version,
    updatedAt: r.updated_at,
  };
}

// ?action=getStaffAssignments
// Mirrors Code.gs viewer scoping: admins see the roster; non-admin staff see
// only their own assignments and never receive hours/rate/salary.
function normIdentity(v) {
  return String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

async function syncClassToTeacherUsersRow(env, entry) {
  const className = String(entry?.className || "").trim();
  if (!className) return { success: false, error: "className manquant." };
  const teacherId = String(entry?.teacherId || "").trim();
  const teacherName = String(entry?.teacher || "").trim();
  if (!teacherId && !teacherName) return { success: false, error: "teacherId/teacher manquant." };
  const { results } = await env.DB.prepare(
    `SELECT id, email, user_id, name, assigned_subjects FROM users WHERE deleted_at IS NULL AND (
       (? <> '' AND LOWER(email)=LOWER(?)) OR
       (? <> '' AND LOWER(user_id)=LOWER(?)) OR
       (? <> '' AND LOWER(name)=LOWER(?))
     ) ORDER BY CASE
       WHEN ? <> '' AND LOWER(email)=LOWER(?) THEN 1
       WHEN ? <> '' AND LOWER(user_id)=LOWER(?) THEN 2
       ELSE 3 END LIMIT 1`
  ).bind(teacherId,teacherId,teacherId,teacherId,teacherName,teacherName,teacherId,teacherId,teacherId,teacherId).all();
  const row = results?.[0];
  if (!row) return { success: false, error: `Aucun compte Users correspondant trouvé pour "${teacherName || teacherId}".` };
  let assigned = [];
  try { assigned = JSON.parse(row.assigned_subjects || "[]"); } catch {}
  if (!Array.isArray(assigned)) assigned = [];
  const exists = assigned.some(v => normIdentity(typeof v === "object" ? v?.className : v) === normIdentity(className));
  if (!exists) {
    assigned.push({ className });
    await env.DB.prepare(`UPDATE users SET assigned_subjects=?, version=version+1, updated_at=? WHERE id=?`).bind(JSON.stringify(assigned),nowIso(),row.id).run();
  }
  return { success:true, changed:!exists, userId:row.user_id||row.id, className };
}

export async function getStaffAssignments(_data, auth, env) {
  if (!auth || !auth.token) return authError();
  const viewer = await loadViewer(env, auth);
  if (!viewer) return { success:false, error:"Session expirée ou token invalide." };
  const orgId = await resolveOrgId(env);
  const { results } = await env.DB.prepare(
    `SELECT id, teacher_name, teacher_id, class_name, class_id, subject, day, start_time, end_time,
            hours, rate, salary, payment_mode, has_conflict, version, updated_at, meta_json
     FROM teacher_assignments WHERE org_id=? AND deleted_at IS NULL AND active=1
     ORDER BY teacher_name, class_name`
  ).bind(orgId).all();
  const assignments=(results||[]).map(assignmentRowToApi);
  const isAdminCaller=!!(viewer.isMaster||viewer.isGodMode||viewer.permissions?.p_staff||viewer.permissions?.pa_teacher_affectation);
  if(isAdminCaller) return {success:true,data:assignments};
  const myTokens=[viewer.name,viewer.email,viewer.userId,viewer.username].map(normIdentity).filter(Boolean);
  const mine=assignments.filter(a=>[a.teacher,a.teacherId].map(normIdentity).some(t=>t&&myTokens.includes(t)));
  return {success:true,data:mine.map(a=>{const copy={...a};delete copy.hours;delete copy.rate;delete copy.salary;return copy;})};
}


// {action: "saveStaffAssignment", data: {id?, teacher, teacherId?, className,
//   classId?, subject, day?, start?, end?, hours?, rate?, salary?,
//   payMode?/paymentMode?, hasConflict?, _meta?}}
// Matches an existing row the same two ways Code.gs does — by id first,
// then by the (teacher, className, subject, day, start) composite key —
// so re-saving the same slot updates it in place instead of duplicating.
export async function saveStaffAssignment(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await currentViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const entry = data || {};

    const teacher = String(entry.teacher || "").trim();
    const className = String(entry.className || "").trim();
    if (!teacher || !className) {
      return { success: false, error: "teacher et className sont requis." };
    }
    const subject = String(entry.subject || "").trim();
    const day = String(entry.day || "").trim();
    const start = String(entry.start || "").trim();
    const end = String(entry.end || "").trim();

    const requestedId = String(entry.id || entry.assignmentId || "").trim();
    let existing = null;
    if (requestedId) {
      existing = await env.DB.prepare(
        `SELECT * FROM teacher_assignments WHERE org_id = ? AND id = ? AND deleted_at IS NULL`
      )
        .bind(orgId, requestedId)
        .first();
    }
    if (!existing) {
      existing = await env.DB.prepare(
        `SELECT * FROM teacher_assignments
         WHERE org_id = ? AND deleted_at IS NULL
           AND teacher_name = ? AND class_name = ? AND subject = ? AND day = ? AND start_time = ?`
      )
        .bind(orgId, teacher, className, subject, day, start)
        .first();
    }

    const assignmentId = requestedId || (existing ? existing.id : generateAssignmentId());
    const teacherId = String(entry.teacherId || teacher).trim();
    const classId = String(entry.classId || className).trim();
    const hours = Number(entry.hours || 0) || 0;
    const rate = Number(entry.rate || 0) || 0;
    const salary = Number(entry.salary || 0) || 0;
    const hasConflict = entry.hasConflict ? 1 : 0;
    // FIX ported from Code.gs: the frontend sends `payMode`, not
    // `paymentMode` — only overwrite the stored value with a recognized
    // HOURLY/FIXED value; otherwise keep whatever was already stored
    // (blank on a brand-new row), same fallback as saveStaffAssignment_.
    const requestedMode = String(entry.payMode || entry.paymentMode || "").trim().toUpperCase();
    const paymentMode =
      requestedMode === "HOURLY" || requestedMode === "FIXED"
        ? requestedMode
        : existing
        ? existing.payment_mode || ""
        : "";
    const ts = nowIso();
    const createdAt = existing ? existing.created_at : ts;
    const nextVersion = existing ? Number(existing.version) + 1 : 1;
    const metaJson = JSON.stringify(entry._meta || {});

    await env.DB.prepare(
      `INSERT INTO teacher_assignments
         (id, org_id, teacher_name, teacher_id, class_name, class_id, subject, day, start_time, end_time,
          hours, rate, salary, payment_mode, has_conflict, active, created_at, version, updated_at, deleted_at, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         teacher_name = excluded.teacher_name,
         teacher_id = excluded.teacher_id,
         class_name = excluded.class_name,
         class_id = excluded.class_id,
         subject = excluded.subject,
         day = excluded.day,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         hours = excluded.hours,
         rate = excluded.rate,
         salary = excluded.salary,
         payment_mode = excluded.payment_mode,
         has_conflict = excluded.has_conflict,
         active = 1,
         version = excluded.version,
         updated_at = excluded.updated_at,
         deleted_at = NULL,
         meta_json = excluded.meta_json`
    )
      .bind(
        assignmentId,
        orgId,
        teacher,
        teacherId,
        className,
        classId,
        subject,
        day,
        start,
        end,
        hours,
        rate,
        salary,
        paymentMode,
        hasConflict,
        createdAt,
        nextVersion,
        ts,
        metaJson
      )
      .run();

    await writeAudit(env.DB, {
      table: "teacher_assignments",
      rowId: assignmentId,
      userId: viewer.userId,
      deviceId: entry.deviceId,
      op: existing ? "update" : "insert",
      diff: { teacher, className, subject, day, start, end, hours, rate, salary, paymentMode },
    });

    let usersSync = null;
    try { usersSync = await syncClassToTeacherUsersRow(env, { ...entry, teacher, teacherId, className }); }
    catch (e) { usersSync = { success:false, error:e.message }; }
    return { success:true, data:{ id:assignmentId, usersSync } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "deleteStaffAssignment", data: {id?/assignmentId?, teacher?,
//   className?, subject?}}
// Never hard-deletes — sets Active=FALSE (soft delete) and bumps
// updated_at, same convention as Code.gs. Matches by id first, then by
// the (teacher, className, subject) composite, same as the original.
export async function deleteStaffAssignment(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await currentViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const entry = data || {};
    const targetId = String(entry.id || entry.assignmentId || "").trim();

    let existing = null;
    if (targetId) {
      existing = await env.DB.prepare(
        `SELECT * FROM teacher_assignments WHERE org_id = ? AND id = ? AND deleted_at IS NULL`
      )
        .bind(orgId, targetId)
        .first();
    } else {
      existing = await env.DB.prepare(
        `SELECT * FROM teacher_assignments
         WHERE org_id = ? AND deleted_at IS NULL AND teacher_name = ? AND class_name = ? AND subject = ?`
      )
        .bind(orgId, String(entry.teacher || "").trim(), String(entry.className || "").trim(), String(entry.subject || "").trim())
        .first();
    }
    if (!existing) return { success: true }; // same as Code.gs: no match is not an error

    const ts = nowIso();
    const nextVersion = Number(existing.version) + 1;
    await env.DB.prepare(
      `UPDATE teacher_assignments SET active = 0, version = ?, updated_at = ? WHERE id = ? AND org_id = ?`
    )
      .bind(nextVersion, ts, existing.id, orgId)
      .run();

    await writeAudit(env.DB, {
      table: "teacher_assignments",
      rowId: existing.id,
      userId: viewer.userId,
      deviceId: entry.deviceId,
      op: "delete",
      diff: { teacher: existing.teacher_name, className: existing.class_name, subject: existing.subject },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Thin aliases — same relationship as createSubject_/deleteSubject_ to
// saveStaffAssignment_/deleteStaffAssignment_ in Code.gs.
export async function createSubject(data, auth, env) {
  if (!data) return { success: false, error: "Payload manquant." };
  return saveStaffAssignment(
    {
      id: data.code || data.id,
      teacher: data.teacherId || data.teacher || "",
      teacherId: data.teacherId || data.teacher || "",
      className: data.classId || data.className || "",
      classId: data.classId || data.className || "",
      subject: data.name || data.subject || "",
      hours: data.hoursPerWeek || data.hours || 0,
      rate: data.rate || 0,
      salary: data.salary || 0,
      day: data.day || "",
      start: data.startTime || data.start || "",
      end: data.endTime || data.end || "",
      hasConflict: !!data.hasConflict,
    },
    auth,
    env
  );
}

export async function deleteSubject(data, auth, env) {
  if (!data) return { success: false, error: "Payload manquant." };
  return deleteStaffAssignment(data, auth, env);
}
