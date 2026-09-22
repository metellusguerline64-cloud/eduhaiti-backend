import { getAiProviderKey } from "../lib/ai_key_store.js";
import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { checkAiQuota } from "./ai_tokens.js";

function canUse(viewer) { return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_use_ai)); }
function messagesOf(data) {
  const history = Array.isArray(data?.messages || data?.history) ? (data.messages || data.history) : [];
  const messages = history.map((item) => ({ role: item?.role === "assistant" ? "assistant" : "user", content: String(item?.content || item?.text || "").slice(0, 8000) })).filter((item) => item.content);
  const text = String(data?.message || data?.text || data?.prompt || "").trim();
  if (text) messages.push({ role: "user", content: text.slice(0, 8000) });
  return messages.slice(-20);
}

async function saveChatMessage(db, orgId, userId, conversationId, role, content) {
  await db.prepare(`INSERT INTO ai_chat_messages(id,org_id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), orgId, userId, conversationId, role, content, new Date().toISOString()).run();
}

export async function processUserMessage(data, auth, env) {
  const viewer = auth?.token ? await loadViewer(env, auth) : null;
  if (!viewer) return { success: false, error: "SESSION_EXPIREE" };
  if (!canUse(viewer)) return { success: false, error: "PERMISSION_REFUSEE" };
  const messages = messagesOf(data);
  if (!messages.length) return { success: false, error: "message requis." };
  const conversationId = String(data?.conversationId || crypto.randomUUID()).slice(0, 120);
  const quota = await checkAiQuota({ conversationId }, auth, env);
  if (!quota.success) return quota;
  if (!quota.allowed) return { success: false, error: "AI_QUOTA_EXCEEDED", quota };
  const apiKey = await getAiProviderKey(env,"anthropic");
  if (!apiKey) return { success: false, error: "AI_KEY_NOT_CONFIGURED" };
  try {
    const orgId = await resolveOrgId(env);
    const currentUserMessage = [...messages].reverse().find((message) => message.role === "user");
    await saveChatMessage(env.DB, orgId, viewer.id, conversationId, "user", currentUserMessage.content);
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages }) });
    if (!response.ok) return { success: false, error: `AI_PROVIDER_ERROR_${response.status}` };
    const body = await response.json();
    const reply = String(body?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") || "").trim();
    if (!reply) return { success: false, error: "AI_EMPTY_RESPONSE" };
    const usage = body?.usage || {};
    await saveChatMessage(env.DB, orgId, viewer.id, conversationId, "assistant", reply);
    await env.DB.prepare(`INSERT INTO ai_token_usage(id,org_id,user_id,conversation_id,tokens_in,tokens_out,model,provider,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), orgId, viewer.id, conversationId, Number(usage.input_tokens) || 0, Number(usage.output_tokens) || 0, "claude-haiku-4-5-20251001", "anthropic", new Date().toISOString()).run();
    return { success: true, reply, text: reply, message: reply, conversationId, model: "claude-haiku-4-5-20251001", usage: { tokensIn: Number(usage.input_tokens) || 0, tokensOut: Number(usage.output_tokens) || 0 } };
  } catch (error) { return { success: false, error: error.message }; }
}