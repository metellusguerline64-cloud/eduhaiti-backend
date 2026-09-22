import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";

const DEFAULTS = {
  anthropic: { model: "claude-haiku-4-5-20251001", apiUrl: "https://api.anthropic.com/v1/messages" },
  openai: { model: "gpt-4o-mini", apiUrl: "https://api.openai.com/v1/chat/completions" },
  google: { model: "gemini-2.0-flash", apiUrl: "" },
};

function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(value) { return Uint8Array.from(atob(String(value)), (c) => c.charCodeAt(0)); }
async function key(env) {
  const secret = String(env.AI_USER_CONFIG_KEY || "").trim();
  if (!secret) throw new Error("Secret Worker AI_USER_CONFIG_KEY manquant.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(cipher)}`;
}
async function decrypt(env, encoded) {
  const [iv, cipher] = String(encoded || "").split(".");
  if (!iv || !cipher) throw new Error("Configuration IA chiffrée invalide.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env), unb64(cipher));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function current(env, auth) { return auth?.token ? loadViewer(env, auth) : null; }
function canUse(viewer) { return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_use_ai)); }
function normalize(data) {
  let provider = String(data?.provider || "anthropic").toLowerCase().trim();
  if (provider === "claude") provider = "anthropic";
  if (provider === "gemini") provider = "google";
  if (!DEFAULTS[provider]) provider = "anthropic";
  return {
    apiKey: String(data?.apiKey || "").trim(),
    provider,
    model: String(data?.model || DEFAULTS[provider].model).trim(),
    apiUrl: String(data?.apiUrl || DEFAULTS[provider].apiUrl).trim(),
  };
}
async function stored(env, viewer) {
  const orgId = await resolveOrgId(env);
  return env.DB.prepare(`SELECT config_enc FROM ai_user_configs WHERE user_id=? AND org_id=?`).bind(viewer.id, orgId).first();
}

export async function setUserAiApiKey(data, auth, env) {
  const viewer = await current(env, auth);
  if (!viewer) return { success: false, message: "Session expirée." };
  if (!canUse(viewer)) return { success: false, message: "Permission p_use_ai requise." };
  try {
    const orgId = await resolveOrgId(env);
    const config = normalize(data);
    if (!config.apiKey) {
      await env.DB.prepare(`DELETE FROM ai_user_configs WHERE user_id=? AND org_id=?`).bind(viewer.id, orgId).run();
      return { success: true, message: "Clé effacée.", provider: config.provider, model: config.model };
    }
    await env.DB.prepare(`INSERT INTO ai_user_configs(user_id,org_id,config_enc,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET org_id=excluded.org_id,config_enc=excluded.config_enc,updated_at=excluded.updated_at`)
      .bind(viewer.id, orgId, await encrypt(env, config), new Date().toISOString()).run();
    return { success: true, message: "Clé enregistrée.", provider: config.provider, model: config.model };
  } catch (error) { return { success: false, message: error.message }; }
}

export async function getUserAiApiKeyStatus(_data, auth, env) {
  const viewer = await current(env, auth);
  if (!viewer || !canUse(viewer)) return { configured: false };
  try {
    const row = await stored(env, viewer);
    if (!row) return { configured: false };
    const config = await decrypt(env, row.config_enc);
    return { configured: true, provider: config.provider, model: config.model };
  } catch { return { configured: false }; }
}

export async function verifyUserAiApiKey(_data, auth, env) {
  const viewer = await current(env, auth);
  if (!viewer) return { success: false, message: "Session expirée." };
  if (!canUse(viewer)) return { success: false, message: "Permission p_use_ai requise." };
  try {
    const row = await stored(env, viewer);
    if (!row) return { success: false, message: "Aucune clé configurée." };
    const config = await decrypt(env, row.config_enc);
    let response;
    if (config.provider === "anthropic") {
      response = await fetch(config.apiUrl, { method: "POST", headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: config.model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] }) });
    } else if (config.provider === "openai") {
      response = await fetch(config.apiUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] }) });
    } else {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } }) });
    }
    return response.ok ? { success: true, message: "Clé valide.", provider: config.provider, model: config.model } : { success: false, message: `Clé refusée par le fournisseur (${response.status}).` };
  } catch (error) { return { success: false, message: error.message }; }
}