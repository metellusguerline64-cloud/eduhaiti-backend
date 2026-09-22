import { resolveOrgId } from "../lib/org.js";
import { loadViewer } from "../lib/accessScope.js";

function fail(error) { return { success: false, error }; }

export async function getPushConfig(_data, _auth, env) {
  const key = String(env.VAPID_PUBLIC_KEY || "").trim();
  if (!key) return fail("Web Push non configuré : VAPID_PUBLIC_KEY manquante.");
  return { success: true, channel: "PUSH", publicKey: key };
}

export async function registerPushSubscription(data, auth, env) {
  const viewer = await loadViewer(env, auth);
  if (!viewer) return fail("Session invalide.");
  const subscription = data?.subscription || data;
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const authKey = String(subscription?.keys?.auth || "").trim();
  const ownerType = String(data?.ownerType || "parent").trim().toLowerCase();
  const ownerId = String(data?.ownerId || viewer.userId || viewer.email || "").trim();
  if (!endpoint || !p256dh || !authKey) return fail("Abonnement Web Push incomplet.");
  if (!ownerId || !["parent", "student", "staff"].includes(ownerType)) return fail("Propriétaire de l’abonnement invalide.");
  const orgId = await resolveOrgId(env);
  const now = new Date().toISOString();
  const id = `PUSH-${crypto.randomUUID()}`;
  const existing = await env.DB.prepare(`SELECT id FROM push_subscriptions WHERE org_id=? AND endpoint=?`).bind(orgId, endpoint).first();
  if (existing) {
    await env.DB.prepare(`UPDATE push_subscriptions SET owner_type=?,owner_id=?,p256dh=?,auth=?,user_agent=?,active=1,updated_at=?,deleted_at=NULL WHERE id=?`)
      .bind(ownerType, ownerId, p256dh, authKey, String(data?.userAgent || ""), now, existing.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO push_subscriptions
      (id,org_id,owner_type,owner_id,endpoint,p256dh,auth,user_agent,active,created_at,updated_at,deleted_at)
      VALUES(?,?,?,?,?,?,?, ?,1,?,?,NULL)`)
      .bind(id, orgId, ownerType, ownerId, endpoint, p256dh, authKey, String(data?.userAgent || ""), now, now).run();
  }
  return { success: true, channel: "PUSH", ownerType, ownerId };
}

export async function unregisterPushSubscription(data, auth, env) {
  const viewer = await loadViewer(env, auth);
  if (!viewer) return fail("Session invalide.");
  const endpoint = String(data?.endpoint || "").trim();
  if (!endpoint) return fail("Endpoint manquant.");
  const orgId = await resolveOrgId(env);
  await env.DB.prepare(`UPDATE push_subscriptions SET active=0,deleted_at=?,updated_at=? WHERE org_id=? AND endpoint=?`)
    .bind(new Date().toISOString(), new Date().toISOString(), orgId, endpoint).run();
  return { success: true, channel: "PUSH" };
}

export async function listPushNotifications(data, auth, env) {
  const viewer = await loadViewer(env, auth);
  if (!viewer) return fail("Session invalide.");
  const orgId = await resolveOrgId(env);
  const ownerType = String(data?.ownerType || "parent").trim().toLowerCase();
  const ownerId = String(data?.ownerId || viewer.userId || viewer.email || "").trim();
  const { results = [] } = await env.DB.prepare(`SELECT id,title,body,data_json,status,created_at FROM push_notifications
    WHERE org_id=? AND owner_type=? AND owner_id IN (?, '*') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`)
    .bind(orgId, ownerType, ownerId).all();
  return { success: true, channel: "PUSH", items: results.map(r => ({ id:r.id, title:r.title, body:r.body, data:JSON.parse(r.data_json || "{}"), status:r.status, createdAt:r.created_at })) };
}