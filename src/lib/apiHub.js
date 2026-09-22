// Port of apiHub()/normalizeApiHubResponse_() from Code.gs.
//
// IMPORTANT: the frontend's callApiHub_ (Path B) and downstream code read
// specific fields off the response (success, data, meta, count...). This
// normalizer reproduces normalizeApiHubResponse_'s exact shape so nothing
// in school.html needs to change just because the backend moved.

import { actions } from "../actions/index.js";
import { loadSessionToken } from "./session.js";
import { writeAudit } from "./audit.js";
import {
  checkActionPermission,
  PERMISSION_ACTION_ALIASES,
  UNPOLICED_ACTIONS,
} from "./permissions.js";

export function normalizeApiHubResponse(action, result) {
  const meta = { action, timestamp: new Date().toISOString() };

  if (result === undefined || result === null) {
    return { success: true, data: null, meta };
  }
  if (Array.isArray(result)) {
    return { success: true, data: result, count: result.length, meta };
  }
  if (typeof result === "object") {
    if (Object.prototype.hasOwnProperty.call(result, "success")) {
      const out = { ...result };
      if (!("meta" in out)) out.meta = meta;
      if (out.success && !("data" in out)) {
        if ("rows" in out) out.data = out.rows;
        else if ("result" in out) out.data = out.result;
      }
      return out;
    }
    return { success: true, data: result, meta };
  }
  return { success: true, data: result, meta };
}

// A small subset of normalizeApiHubRequest_'s alias table — extend this as
// more actions get ported. Keeping it here (not scattered per-action) keeps
// the single source of truth the same way Code.gs did.
const ALIASES = {
  attemptSheetLogin_: "attemptSheetLogin",
  forcePasswordUpdate_: "forcePasswordUpdate",
  getStaffList: "getAllAdminUsers",
  getStaffManagementData: "getAllAdminUsers",
  saveStaffAccess: "updateUserRoleAndPerms",
};

// Resolves a session token into the same { permissions, isMaster,
// isGodMode, ... } shape getViewerInfo returns, for checkActionPermission
// to gate on. Deliberately minimal (no role/display fields) — this is
// only ever used for the permission decision, never returned to the
// client. A missing/expired/unknown token resolves to `null`, same as an
// unauthenticated viewer in Code.gs; whether that's rejected depends on
// the action's own policy entry (an empty '' requirement still passes
// with a null viewer, same as ACTION_PERMISSIONS intends).
async function resolveViewerForPermissionCheck(env, token) {
  if (!token || !env || !env.DB) return null;
  const session = await loadSessionToken(env.DB, token);
  if (!session) return null;
  const user = await env.DB.prepare(
    `SELECT permissions_json, is_master, is_god_mode, active FROM users
       WHERE deleted_at IS NULL AND (id = ? OR user_id = ? OR email = ?)`
  )
    .bind(session.userId, session.userId, session.email)
    .first();
  if (!user || Number(user.active) === 0) return null;
  let permissions = {};
  try {
    permissions = JSON.parse(user.permissions_json || "{}");
  } catch {
    permissions = {};
  }
  return {
    userId: user.id || session.userId,
    email: user.email || session.email || "",
    permissions,
    isMaster: Number(user.is_master) === 1,
    isGodMode: Number(user.is_god_mode) === 1,
  };
}

export async function apiHub(rawAction, data, token, env) {
  const action = ALIASES[rawAction] || rawAction;
  const auth = token ? { token: String(token) } : null;

  const handler = actions[action];
  if (!handler) {
    return normalizeApiHubResponse(action, {
      success: false,
      error: `Action non implémentée côté Cloudflare (pas encore portée) : ${action}`,
    });
  }

  // Permission gate — action-based, never role-based (see permissions.js
  // header). Skipped only for UNPOLICED_ACTIONS (Worker-native actions
  // with no Code.gs policy equivalent to port from); every action that
  // exists in Code.gs's original `policy` object is enforced here, the
  // same gate Code.gs itself ran right before its ACTION SWITCH.
  if (!UNPOLICED_ACTIONS.has(action)) {
    const permAction = PERMISSION_ACTION_ALIASES[action] || action;
    const viewer = await resolveViewerForPermissionCheck(env, token);
    const decision = checkActionPermission(viewer, permAction);
    if (!decision.allowed) {
      // Code.gs records rejected permission checks in AuditLog. Preserve that
      // security event in D1 without exposing token/session material.
      try {
        await writeAudit(env.DB, {
          table: "security",
          rowId: action,
          userId: viewer?.userId || viewer?.id || null,
          deviceId: data?.deviceId || null,
          op: "permission_denied",
          permission: permAction,
          status: "ECHEC",
          diff: { action, required: decision.required || permAction, error: decision.error || "Permission denied" }
        });
      } catch (_) {}
      return normalizeApiHubResponse(action, { success: false, error: decision.error });
    }
  }

  try {
    const result = await handler(data || {}, auth, env);
    return normalizeApiHubResponse(action, result);
  } catch (err) {
    return normalizeApiHubResponse(action, {
      success: false,
      error: "Erreur serveur: " + (err && err.message ? err.message : String(err)),
    });
  }
}
