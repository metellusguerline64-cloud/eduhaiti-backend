// timetable.js — REAL port of Code.gs's class-timetable actions,
// verified with Code.gs in context. Real Sheet: 'timetable', headers
// SlotID/ClassName/DayIndex/DayLabel/StartTime/EndTime/Subject/Teacher/
// TeacherID/Conflict/Active/CreatedAt/UpdatedAt/MetaJSON (Code.gs
// ensureTimetableSheetStructure_). Ported functions:
//   - getTimetableData_ → getTimetableData (Code.gs ~line 23921)
//   - saveTimetableData_ → saveTimetableData (Code.gs ~line 23964)
//
// INTENTIONAL DEVIATION (not a silent gap — flagged): apiHub's dispatcher
// calls getTimetableData_()/saveTimetableData_(data) with NO auth
// parameter at all — Code.gs itself never checks a token before serving
// or overwriting the whole school's timetable via these two actions.
// This port requires a valid session token (same minimum bar every other
// ported action in this file uses) rather than reproducing that gap
// as-is; treat this as a security fix riding along with the port, not a
// behavior this D1 backend is trying to match exactly.
//
// REPLACE SEMANTICS: saveTimetableData_ in Code.gs clears the ENTIRE
// sheet body and rewrites it from the payload on every call — the
// timetable screen always sends its full current state, never a partial
// diff. This D1 port reproduces that end state (whatever wasn't in the
// payload is gone) via soft-delete instead of a hard wipe: every
// currently-active row for this org not present in the new payload gets
// deleted_at set, and every row in the payload is upserted. This keeps
// the same sync-engine tombstone convention every other table uses
// (see src/lib/sync.js) instead of silently disappearing rows with no
// delta-pull signal for offline clients.
//
// Viewer/permission scoping is enforced in both read and write actions
// using the same ACTION_PERMISSIONS keys as Code.gs.
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { loadSessionToken } from "../lib/session.js";
import { loadViewer } from "../lib/accessScope.js";
import { checkActionPermission } from "../lib/permissions.js";

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

function generateSlotId() {
  return "TT-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function slotRowToApi(r) {
  let meta = {};
  try {
    meta = JSON.parse(r.meta_json || "{}");
  } catch {
    meta = {};
  }
  return {
    id: r.id,
    className: r.class_name,
    dayIndex: r.day_index,
    dayLabel: r.day_label,
    startTime: r.start_time,
    endTime: r.end_time,
    subject: r.subject,
    teacher: r.teacher,
    teacherId: r.teacher_id,
    conflict: Number(r.conflict) === 1,
    _meta: meta,
  };
}

// ?action=getTimetableData
export async function getTimetableData(_data, auth, env) {
  if (!auth || !auth.token) return authError();
  const viewer = await loadViewer(env, auth);
  if (!viewer) return { success:false, error:"Session expirée ou token invalide." };
  const gate = checkActionPermission(viewer, "getTimetableData");
  if (!gate.allowed) return { success:false, error:gate.error };
  const orgId = await resolveOrgId(env);

  const { results } = await env.DB.prepare(
    `SELECT id, class_name, day_index, day_label, start_time, end_time, subject, teacher, teacher_id,
            conflict, meta_json
     FROM timetable
     WHERE org_id = ? AND deleted_at IS NULL AND active = 1
     ORDER BY day_index, start_time`
  )
    .bind(orgId)
    .all();

  return { success: true, data: (results || []).map(slotRowToApi) };
}

// {action: "saveTimetableData", data: [...] | {slots: [...]}}
// Full-state replace — see header comment for the soft-delete-based
// implementation of Code.gs's "clear then rewrite" behavior.
export async function saveTimetableData(payload, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    if (!viewer) return { success:false, error:"Session expirée ou token invalide." };
    const gate = checkActionPermission(viewer, "saveTimetableData");
    if (!gate.allowed) return { success:false, error:gate.error };

    const slots = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.slots)
      ? payload.slots
      : [];

    const ts = nowIso();

    if (!slots.length) {
      // Same as Code.gs: an empty payload clears the whole timetable.
      const { results: activeIds } = await env.DB.prepare(
        `SELECT id FROM timetable WHERE org_id = ? AND deleted_at IS NULL AND active = 1`
      )
        .bind(orgId)
        .all();
      for (const row of activeIds || []) {
        await env.DB.prepare(
          `UPDATE timetable SET active = 0, deleted_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`
        )
          .bind(ts, ts, row.id, orgId)
          .run();
      }
      await writeAudit(env.DB, {
        table: "timetable",
        rowId: orgId,
        userId: viewer.userId,
        deviceId: payload && payload.deviceId,
        op: "delete",
        diff: { clearedCount: (activeIds || []).length },
      });
      return { success: true, data: [] };
    }

    const keepIds = new Set();
    const savedRows = [];

    for (const slot of slots) {
      const id = String(slot.id || generateSlotId()).trim();
      keepIds.add(id);

      const existing = await env.DB.prepare(
        `SELECT created_at, version FROM timetable WHERE org_id = ? AND id = ?`
      )
        .bind(orgId, id)
        .first();
      const nextVersion = existing ? Number(existing.version) + 1 : 1;
      const createdAt = existing ? existing.created_at : ts;

      await env.DB.prepare(
        `INSERT INTO timetable
           (id, org_id, class_name, day_index, day_label, start_time, end_time, subject, teacher, teacher_id,
            conflict, active, created_at, version, updated_at, deleted_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           class_name = excluded.class_name,
           day_index = excluded.day_index,
           day_label = excluded.day_label,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           subject = excluded.subject,
           teacher = excluded.teacher,
           teacher_id = excluded.teacher_id,
           conflict = excluded.conflict,
           active = 1,
           version = excluded.version,
           updated_at = excluded.updated_at,
           deleted_at = NULL,
           meta_json = excluded.meta_json`
      )
        .bind(
          id,
          orgId,
          String(slot.className || "").trim(),
          Number(slot.dayIndex || 0),
          String(slot.dayLabel || "").trim(),
          String(slot.startTime || "").trim(),
          String(slot.endTime || "").trim(),
          String(slot.subject || "").trim(),
          String(slot.teacher || "").trim(),
          String(slot.teacherId || "").trim(),
          slot.conflict ? 1 : 0,
          createdAt,
          nextVersion,
          ts,
          JSON.stringify(slot._meta || {})
        )
        .run();

      savedRows.push({ ...slot, id });
    }

    // Soft-delete every row that used to be active but wasn't in this save.
    const { results: currentlyActive } = await env.DB.prepare(
      `SELECT id FROM timetable WHERE org_id = ? AND deleted_at IS NULL AND active = 1`
    )
      .bind(orgId)
      .all();
    const toRemove = (currentlyActive || []).filter((r) => !keepIds.has(r.id));
    for (const row of toRemove) {
      await env.DB.prepare(
        `UPDATE timetable SET active = 0, deleted_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`
      )
        .bind(ts, ts, row.id, orgId)
        .run();
    }

    await writeAudit(env.DB, {
      table: "timetable",
      rowId: orgId,
      userId: viewer.userId,
      deviceId: payload && payload.deviceId,
      op: "update",
      diff: { savedCount: savedRows.length, removedCount: toRemove.length },
    });

    return { success: true, data: savedRows };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
