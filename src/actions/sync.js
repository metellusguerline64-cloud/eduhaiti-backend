import { loadSessionToken } from "../lib/session.js";
import { deltaPull, applyOutboxBatch, SYNC_TABLES } from "../lib/sync.js";
import { typedDeltaPull, applyTypedOutboxBatch, TYPED_SYNC_TABLES } from "../lib/typedSync.js";
import { resolveOrgId } from "../lib/org.js";

async function requireSession(auth, env) {
  if (!auth || !auth.token) return { error: "Non authentifié." };
  const session = await loadSessionToken(env.DB, auth.token);
  if (!session) return { error: "Session expirée ou invalide." };
  return { session };
}

export async function syncPull(data, auth, env) {
  const { error, session } = await requireSession(auth, env);
  if (error) return { success: false, error };
  const table = String(data.table || "");
  if (TYPED_SYNC_TABLES.has(table)) {
    const orgId = await resolveOrgId(env);
    const result = await typedDeltaPull(env.DB, table, orgId, data.cursor, data.limit);
    return { success: true, ...result };
  }
  if (!SYNC_TABLES.has(table)) return { success: false, error: `Table de synchronisation inconnue : ${table}` };
  const result = await deltaPull(env.DB, table, data.cursor, data.limit);
  return { success: true, ...result };
}

export async function syncPush(data, auth, env) {
  const { error, session } = await requireSession(auth, env);
  if (error) return { success: false, error };
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) return { success: false, error: "Aucune entrée à synchroniser." };
  if (entries.length > 500) return { success: false, error: "Lot trop volumineux (max 500 entrées)." };

  const orgId = await resolveOrgId(env);
  const typedEntries = entries.filter(e => TYPED_SYNC_TABLES.has(String(e?.table || "")));
  const genericEntries = entries.filter(e => !TYPED_SYNC_TABLES.has(String(e?.table || "")));
  const outcomes = [];
  if (typedEntries.length) outcomes.push(...await applyTypedOutboxBatch(env.DB, typedEntries, { orgId, userId: session.userId, deviceId: data.deviceId }));
  if (genericEntries.length) outcomes.push(...await applyOutboxBatch(env.DB, genericEntries, { userId: session.userId, deviceId: data.deviceId }));
  const conflicts = outcomes.filter(o => o.status === "conflict").length;
  const duplicates = outcomes.filter(o => o.status === "duplicate").length;
  return { success: true, outcomes, conflicts, duplicates };
}
