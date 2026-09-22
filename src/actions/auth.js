import { hashPin } from "../lib/hash.js";
import { storeSessionToken, loadSessionToken, revokeSessionsForUser } from "../lib/session.js";

const SESSION_TOKEN_TTL_SECONDS = 86400;

export async function ping() {
  return { success: true, status: "online", timestamp: new Date().toISOString() };
}

// Port of attemptSheetLogin_(identifier, password) — same lookup order
// (email OR user_id OR username), same "prefer active match, fall back to
// inactive to surface 'Compte suspendu'" behavior, same RESET_REQUIRED
// detection for the default password.
export async function attemptSheetLogin(data, _auth, env) {
  const identifier = String(data.identifier || data.email || data.userId || data.username || "").trim().toLowerCase();
  const rawPassword = String(data.password || "").trim();

  if (!identifier || !rawPassword) {
    return { success: false, message: "Identifiants incorrects." };
  }

  const candidates = await env.DB.prepare(
    `SELECT * FROM users WHERE deleted_at IS NULL AND
       (LOWER(email) = ? OR LOWER(user_id) = ? OR LOWER(username) = ?)`
  )
    .bind(identifier, identifier, identifier)
    .all();

  const rows = candidates.results || [];
  if (!rows.length) {
    return { success: false, message: "Identifiants incorrects." };
  }

  const hashed = await hashPin(rawPassword);
  const normalizedPhone = rawPassword.replace(/\D/g, "");
  const normalizedPhoneHash = normalizedPhone.length >= 7 ? await hashPin(normalizedPhone) : "";
  const passMatches = (row) => {
    const stored = String(row.password_hash || "").trim().toLowerCase();
    return stored === hashed || (Number(row.reset_required) === 1 && normalizedPhoneHash && stored === normalizedPhoneHash);
  };
  const isActive = (row) => Number(row.active) !== 0;

  // Same preference order as Code.gs: active + matching first, then any match
  // (so a suspended account still gets a clear "Compte suspendu" instead of
  // a generic "Identifiants incorrects").
  let user = rows.find((r) => passMatches(r) && isActive(r));
  if (!user) user = rows.find((r) => passMatches(r));
  if (!user) return { success: false, message: "Identifiants incorrects." };
  if (!isActive(user)) return { success: false, message: "Compte suspendu." };

  const token = crypto.randomUUID();
  const sessionPayload = {
    userId: user.user_id || user.id,
    email: user.email || "",
    role: user.role || "",
  };
  await storeSessionToken(env.DB, token, sessionPayload, SESSION_TOKEN_TTL_SECONDS);

  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), user.id)
    .run();

  const isDefaultPassword = hashed === (await hashPin("123456"));
  if (Number(user.reset_required) === 1 || isDefaultPassword) {
    return { success: true, status: "RESET_REQUIRED", token };
  }
  return { success: true, status: "AUTHORIZED", token };
}

export async function forcePasswordUpdate(data, auth, env) {
  if (!auth?.token) return { success: false, error: "Session temporaire invalide." };
  const session = await loadSessionToken(env.DB, auth.token);
  if (!session) return { success: false, error: "Session temporaire expirée." };

  const newPassword = String(data?.newPass || data?.newPassword || "").trim();
  if (newPassword.length < 6) return { success: false, message: "Le nouveau PIN doit contenir au moins 6 caractères." };

  const user = await env.DB.prepare(
    `SELECT id, user_id, email, role, reset_required FROM users
       WHERE deleted_at IS NULL AND (id = ? OR user_id = ? OR email = ?)`
  )
    .bind(session.userId, session.userId, session.email)
    .first();
  if (!user) return { success: false, error: "Utilisateur introuvable." };

  const oldPassword = String(data?.oldPass || "").trim();
  if (oldPassword && String(user.reset_required) !== "1") {
    const oldHash = await hashPin(oldPassword);
    const current = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first();
    if (!current || String(current.password_hash).toLowerCase() !== oldHash) {
      return { success: false, message: "Ancien secret incorrect." };
    }
  }

  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, reset_required = 0, version = version + 1,
       updated_at = ?, last_login_at = ? WHERE id = ?`
  )
    .bind(await hashPin(newPassword), new Date().toISOString(), new Date().toISOString(), user.id)
    .run();

  await revokeSessionsForUser(env.DB, user.id);
  const token = crypto.randomUUID();
  await storeSessionToken(env.DB, token, { userId: user.user_id || user.id, email: user.email || "", role: user.role || "" });
  return { success: true, status: "AUTHORIZED", token };
}

// Port of getViewerInfo_(auth) — enough of it to let the frontend fetch
// "who am I" right after login. Extend as more profile fields get ported.
//
// IMPORTANT: role is returned for display only. permissions (parsed from
// permissions_json) is what checkActionPermission (src/lib/permissions.js)
// actually gates on — see that file's header for why this distinction
// matters. isMaster/isGodMode bypass every permission check the same way
// Code.gs's viewer.isMaster/viewer.isGodMode did.
export async function getViewerInfo(_data, auth, env) {
  if (!auth || !auth.token) return { success: false, error: "Non authentifié." };

  const session = await loadSessionToken(env.DB, auth.token);
  if (!session) return { success: false, error: "Session expirée ou invalide." };

  const user = await env.DB.prepare(
    `SELECT id, user_id, email, role, active, permissions_json, is_teacher, assigned_subjects, is_master, is_god_mode
       FROM users WHERE deleted_at IS NULL AND (id = ? OR user_id = ? OR email = ?)`
  )
    .bind(session.userId, session.userId, session.email)
    .first();

  if (!user) return { success: false, error: "Utilisateur introuvable." };
  if (Number(user.active) === 0) return { success: false, error: "Compte suspendu." };

  let permissions = {};
  try {
    permissions = JSON.parse(user.permissions_json || "{}");
  } catch {
    permissions = {};
  }
  let assignedSubjects = {};
  try {
    assignedSubjects = JSON.parse(user.assigned_subjects || "{}");
  } catch {
    assignedSubjects = {};
  }

  return {
    success: true,
    userId: user.user_id || user.id,
    email: user.email,
    role: user.role,
    active: Number(user.active) === 1,
    permissions,
    isTeacher: Number(user.is_teacher) === 1,
    assignedSubjects,
    isMaster: Number(user.is_master) === 1,
    isGodMode: Number(user.is_god_mode) === 1,
  };
}
