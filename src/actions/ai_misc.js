import { getAiProviderKey } from "../lib/ai_key_store.js";
import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

export async function getDirectAiKey(_data, auth, env) {
  const viewer = auth?.token ? await loadViewer(env, auth) : null;
  if (!viewer) return { success: false, error: "SESSION_EXPIREE" };
  const admin = viewer.isMaster || viewer.isGodMode || viewer.permissions?.pa_save_settings || viewer.permissions?.p_settings;
  if (!admin) return { success: false, error: "PERMISSION_REFUSEE", message: "Réservé aux administrateurs." };
  const key = await getAiProviderKey(env,"anthropic");
  if (!/^sk-ant-/i.test(key)) return { success: false, error: "KEY_NOT_FOUND", message: "Aucune clé Anthropic valide configurée côté Worker." };
  await writeAudit(env.DB, { table: "ai_config", rowId: "direct-key", userId: viewer.id, op: "GET_DIRECT_AI_KEY", diff: { provider: "anthropic" } });
  return { success: true, key, model: "claude-haiku-4-5-20251001" };
}

export async function translateMeigensText(data) {
  const text = typeof data === "string" ? data : String(data?.text || "");
  const lang = typeof data === "string" ? "fr" : String(data?.lang || "fr").toLowerCase();
  if (!lang || lang === "fr" || lang === "fra") return text;
  // Apps Script's LanguageApp has no Cloudflare-native equivalent. Preserve
  // the legacy fail-open behavior until a translation provider is configured.
  return text;
}