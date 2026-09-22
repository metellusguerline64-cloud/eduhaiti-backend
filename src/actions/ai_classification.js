import { getAiProviderKey } from "../lib/ai_key_store.js";
import { loadViewer } from "../lib/accessScope.js";

function canUse(viewer) { return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_use_ai)); }
function catalogOf(raw, viewer) {
  let source = raw;
  if (typeof source === "string") {
    try { source = JSON.parse(source); } catch { source = source.split(","); }
  }
  const rows = [];
  if (Array.isArray(source)) {
    for (const item of source) rows.push(typeof item === "string" ? { key: item, description: "", permissions: [] } : item || {});
  } else if (source && typeof source === "object") {
    for (const [key, item] of Object.entries(source)) rows.push(typeof item === "string" ? { key, description: item, permissions: [] } : { key, ...(item || {}) });
  }
  return rows.map((item) => ({ key: String(item.key || item.intent || item.id || item.name || "").trim(), description: String(item.description || item.label || "").trim(), permissions: item.requiredPermissions || item.permissions || [] }))
    .filter((item) => item.key && (!Array.isArray(item.permissions) || item.permissions.length === 0 || item.permissions.some((permission) => viewer.permissions?.[permission] || viewer.isMaster || viewer.isGodMode)));
}

export async function classifyAiIntent(data, auth, env) {
  const viewer = auth?.token ? await loadViewer(env, auth) : null;
  if (!viewer) return { success: false, error: "Session invalide." };
  if (!canUse(viewer)) return { success: false, error: "Permission p_use_ai requise." };
  const text = String(data?.text || "").slice(0, 800).trim();
  if (!text) return { success: false, error: "text requis." };
  const catalog = catalogOf(data?.intents, viewer);
  if (!catalog.length) return { success: true, intent: null, reason: "No allowed intents available for this user." };
  if (catalog.length === 1) return { success: true, intent: catalog[0].key };
  const apiKey = await getAiProviderKey(env,"anthropic");
  if (!apiKey) return { success: false, error: "AI_KEY_NOT_CONFIGURED" };
  const prompt = `You are an intent classifier. Choose exactly one key from this catalog, or none.\n${catalog.map((item) => `- ${item.key}: ${item.description || "No description"}`).join("\n")}\nUser message: "${text}"\nReply only with the key or none.`;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 30, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) return { success: false, error: `AI_PROVIDER_ERROR_${response.status}` };
    const body = await response.json();
    const candidate = String(body?.content?.find((part) => part.type === "text")?.text || "").trim().replace(/^['"`]|['"`]$/g, "");
    const match = catalog.find((item) => item.key === candidate);
    return { success: true, intent: match ? match.key : null };
  } catch (error) { return { success: false, error: error.message }; }
}