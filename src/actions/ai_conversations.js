import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";

function canUse(viewer) { return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_use_ai)); }
async function context(auth, env) {
  const viewer = auth?.token ? await loadViewer(env, auth) : null;
  if (!viewer) return { error: "Session invalide." };
  if (!canUse(viewer)) return { error: "Permission p_use_ai requise." };
  return { viewer, orgId: await resolveOrgId(env) };
}

export async function getAiChatConversationList(data, auth, env) {
  try {
    const ctx = await context(auth, env); if (ctx.error) return { success: false, error: ctx.error };
    const limit = Math.min(50, Math.max(1, Number(data?.limit) || 20));
    const { results = [] } = await env.DB.prepare(`SELECT conversation_id,MAX(created_at) AS updated_at,COUNT(*) AS message_count FROM ai_chat_messages WHERE org_id=? AND user_id=? GROUP BY conversation_id ORDER BY updated_at DESC LIMIT ${limit}`).bind(ctx.orgId, ctx.viewer.id).all();
    return { success: true, items: results.map((row) => ({ conversationId: row.conversation_id, updatedAt: row.updated_at, messageCount: Number(row.message_count) })) };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function getAiChatConversation(data, auth, env) {
  try {
    const ctx = await context(auth, env); if (ctx.error) return { success: false, error: ctx.error };
    const conversationId = String(data?.conversationId || "").trim();
    if (!conversationId) return { success: false, error: "conversationId requis." };
    const limit = Math.min(100, Math.max(1, Number(data?.limit) || 30));
    const { results = [] } = await env.DB.prepare(`SELECT role,content FROM ai_chat_messages WHERE org_id=? AND user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT ${limit}`).bind(ctx.orgId, ctx.viewer.id, conversationId).all();
    return { success: true, conversationId, history: results.reverse() };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function resetAiChatConversation(_data, auth, env) {
  try {
    const ctx = await context(auth, env); if (ctx.error) return { success: false, error: ctx.error };
    const conversationId = crypto.randomUUID();
    return { success: true, conversationId, message: "Nouvelle conversation créée." };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function resetAiTokenSession(data, auth, env) {
  const result = await resetAiChatConversation(data, auth, env);
  return result.success ? { ...result, sessionReset: true, message: "Session IA réinitialisée." } : result;
}

export async function getAiChatLibraryStatus(_data, auth, env) {
  const ctx = await context(auth, env); if (ctx.error) return { success: false, error: ctx.error };
  return { success: true, exists: true, sheetAccessible: false, storage: "D1", orgId: ctx.orgId };
}