// Audit domain — port of Code.gs's getGlobalAuditDashboard_ / getAuditLogs /
// getAuditDiagnostics (Code_gs_background-sync__1_.txt ~lines 12907-13135).
//
// ADAPTED, NOT A LINE-FOR-LINE PORT — flagged deliberately, same spirit as
// every other domain's header comment in this repo:
//
// The original read a Sheets-backed "AuditLog" tab that was written to by
// writeAuditLog_(action, target, details, permission, isFailure) on every
// permission check Code.gs performed — including REJECTED attempts, which
// is why it has Action/Actor/Permission/Status(REUSSITE|ECHEC)/DetailsPreview
// columns. That permission-check gate (checkActionPermission /
// ACTION_PERMISSIONS in src/lib/permissions.js) is NOT wired into this
// Worker's dispatch yet (see README "Deliberately NOT done yet"), so there
// is no equivalent stream of REJECTED/ECHEC attempts to show here.
//
// What this Worker DOES have is `audit_log` (schema.sql), a real D1 table
// every ported write action already inserts into via src/lib/audit.js's
// writeAudit() — table_name/row_id/user_id/device_id/op/diff/created_at.
// That is a *better* source of truth for "what changed" than the old
// Sheet (it's structured, not string-parsed), so this port reads FROM
// audit_log and maps its columns onto the same response shape the
// frontend's audit dashboard screen already expects:
//
//   Code.gs field   audit_log source              Note
//   -------------   ----------------------------   ----------------------
//   Timestamp       created_at                     ISO string, same as before
//   Action          op                              'insert'/'update'/'delete'/...
//   Target          table_name + ':' + row_id       richer than the original's
//                                                    free-text Target string
//   Actor           user_id                         was viewer.email in Code.gs;
//                                                    this D1 users.id — join to
//                                                    users for an email if needed
//   Permission      null                            not tracked (see above)
//   Status          'REUSSITE' (always)             audit_log only ever records
//                                                    a write that already
//                                                    succeeded; there is nothing
//                                                    to mark ECHEC against
//   DetailsPreview  diff, truncated to 200 chars    was already a preview string
//
// An extra `TableName` field is included (non-breaking additive column) so
// callers that want to filter by domain table directly don't have to parse
// it back out of `Target`.
import { loadViewer } from "../lib/accessScope.js";

function denied() {
  return { success: false, error: "Droits insuffisants." };
}
function canView(viewer) {
  return !!(
    viewer &&
    (viewer.isMaster ||
      viewer.isGodMode ||
      viewer.permissions?.p_audit ||
      viewer.permissions?.p_settings ||
      viewer.permissions?.pa_save_settings)
  );
}
function emptyDashboard(pageSize) {
  return {
    success: true,
    data: [],
    summary: {},
    filters: { actions: [], actors: [], permissions: [], statuses: ["REUSSITE", "ECHEC"] },
    columns: ["Timestamp", "Action", "Target", "Actor", "Permission", "Status", "DetailsPreview"],
    total: 0,
    filtered: 0,
    page: 1,
    pageSize: pageSize || 100,
  };
}

// {action: "getGlobalAuditDashboard"|"getAuditLogs", data: {page, pageSize,
//  action, actor, status, target, search, from, to, sortBy, sortDir}}
export async function getGlobalAuditDashboard(data, auth, env) {
  if (!auth?.token) return { success: false, error: "Session invalide." };
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success: false, error: "Session invalide." };
    if (!canView(viewer)) return denied();

    const params = data && typeof data === "object" ? data : {};
    const pageSize = Math.max(10, Math.min(500, Number(params.pageSize || 100)));
    const page = Math.max(1, Number(params.page || 1));

    const actionFilter = String(params.action || "").trim().toLowerCase();
    const actorFilter = String(params.actor || "").trim().toLowerCase();
    const statusFilter = String(params.status || "").trim().toUpperCase();
    const targetFilter = String(params.target || "").trim().toLowerCase();
    const search = String(params.search || "").trim().toLowerCase();
    const fromDate = params.from ? new Date(params.from) : null;
    const toDate = params.to ? new Date(params.to) : null;
    if (toDate && !isNaN(toDate.getTime())) toDate.setHours(23, 59, 59, 999);
    const sortBy = String(params.sortBy || "Timestamp");
    const sortDir = String(params.sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    const { results: totalRow } = await env.DB.prepare(`SELECT COUNT(*) c FROM audit_log`).all();
    const total = (totalRow && totalRow[0] && totalRow[0].c) || 0;
    if (!total) return emptyDashboard(pageSize);

    const orderCol = sortBy === "Action" ? "op" : sortBy === "Actor" ? "user_id" : "created_at";
    // Secondary tie-breaker on rowid, same deterministic-ordering fix the
    // 0019 staff-management hardening pass applied to student_history —
    // multiple audit rows can share the same millisecond timestamp.
    const { results: rows } = await env.DB.prepare(
      `SELECT id, table_name, row_id, user_id, device_id, op, diff, created_at, permission, status
       FROM audit_log ORDER BY ${orderCol} ${sortDir}, rowid ${sortDir}`
    ).all();

    const summary = {};
    const actionsSeen = {}, actorsSeen = {}, permissionsSeen = {}, statusesSeen = {};
    const normalized = (rows || []).map((r) => {
      const act = String(r.op || "UNKNOWN_ACTION");
      summary[act] = (summary[act] || 0) + 1;
      if (act) actionsSeen[act] = true;
      if (r.user_id) actorsSeen[r.user_id] = true;
      if (r.permission) permissionsSeen[r.permission] = true;
      const status = String(r.status || (act === "permission_denied" ? "ECHEC" : "REUSSITE")).toUpperCase();
      statusesSeen[status] = true;
      return {
        Timestamp: r.created_at,
        Action: act,
        Target: `${r.table_name}:${r.row_id}`,
        TableName: r.table_name,
        RowID: r.row_id,
        Actor: r.user_id || "SYSTEM",
        Permission: r.permission || null,
        Status: status,
        DetailsPreview: r.diff ? String(r.diff).slice(0, 200) : "",
        DeviceID: r.device_id || null,
      };
    });

    const filtered = normalized.filter((row) => {
      if (actionFilter && !row.Action.toLowerCase().includes(actionFilter)) return false;
      if (statusFilter && !row.Status.toUpperCase().includes(statusFilter)) return false;
      if (params.permission && !String(row.Permission || "").toLowerCase().includes(String(params.permission).trim().toLowerCase())) return false;
      if (actorFilter && !String(row.Actor).toLowerCase().includes(actorFilter)) return false;
      if (targetFilter && !row.Target.toLowerCase().includes(targetFilter)) return false;
      if (search) {
        const hay = [row.Action, row.Actor, row.Permission, row.Status, row.Target, row.DetailsPreview].join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      const ts = row.Timestamp ? new Date(row.Timestamp) : null;
      if (fromDate && ts && !isNaN(fromDate.getTime()) && ts < fromDate) return false;
      if (toDate && ts && !isNaN(toDate.getTime()) && ts > toDate) return false;
      return true;
    });

    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);
    const uniqSorted = (obj) => Object.keys(obj).sort();

    return {
      success: true,
      data: paged,
      summary,
      filters: {
        actions: uniqSorted(actionsSeen),
        actors: uniqSorted(actorsSeen),
        permissions: Object.keys(permissionsSeen).sort(),
        statuses: Object.keys(statusesSeen).sort(),
      },
      columns: ["Timestamp", "Action", "Target", "Actor", "Permission", "Status", "DetailsPreview"],
      total,
      filtered: filtered.length,
      page,
      pageSize,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// apiHub collapsed 'getGlobalAuditDashboard' and 'getAuditLogs' to the same
// handler (case 'getGlobalAuditDashboard': case 'getAuditLogs': result = ...)
// — same alias relationship kept here.
export const getAuditLogs = getGlobalAuditDashboard;

// {action: "getAuditDiagnostics"} — deliberately unauthenticated in Code.gs
// ("No permission required (safe: read-only)"); kept that way here, same
// as the original comment states, since it exposes only row counts/shape,
// never row content beyond a 3-row truncated sample.
export async function getAuditDiagnostics(_data, _auth, env) {
  try {
    const countRow = await env.DB.prepare(`SELECT COUNT(*) c FROM audit_log`).first();
    const lastRow = (countRow && countRow.c) || 0;
    const sampleRows = lastRow
      ? (
          await env.DB.prepare(
            `SELECT table_name, row_id, user_id, op, permission, status, created_at FROM audit_log ORDER BY created_at DESC LIMIT 3`
          ).all()
        ).results || []
      : [];
    return {
      success: true,
      source: "d1:audit_log",
      auditSheetFound: true, // kept for frontend-contract parity (boolean it already checks)
      auditSheetName: "audit_log",
      auditLastRow: lastRow,
      auditLastCol: 10,
      headerRow: ["id", "table_name", "row_id", "user_id", "device_id", "op", "diff", "created_at", "permission", "status"],
      sampleRows: sampleRows.map((r) => [r.table_name, r.row_id, r.user_id, r.op, r.permission, r.status, r.created_at]),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
