import { resolveOrgId } from "./org.js";

async function keyMaterial(env) {
  const secret = String(env.AI_CONFIG_ENCRYPTION_KEY || "").trim();
  if (!secret) throw new Error("AI_CONFIG_ENCRYPTION_KEY manquant.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name:"AES-GCM" }, false, ["encrypt","decrypt"]);
}
export async function encryptAiSecret(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyMaterial(env);
  const data = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, new TextEncoder().encode(String(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(data)))}`;
}
export async function decryptAiSecret(env, packed) {
  if (!packed) return "";
  const [a,b] = String(packed).split("."); if (!a || !b) return "";
  const iv = Uint8Array.from(atob(a), c=>c.charCodeAt(0));
  const data = Uint8Array.from(atob(b), c=>c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv}, await keyMaterial(env), data);
  return new TextDecoder().decode(plain);
}
export async function getAiProviderKey(env, provider) {
  const envKey = provider === "anthropic" ? (env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY) : env.GEMINI_API_KEY;
  if (String(envKey || "").trim()) return String(envKey).trim();
  const org = await resolveOrgId(env);
  const row = await env.DB.prepare(`SELECT encrypted_key FROM ai_provider_keys WHERE org_id=? AND provider=? LIMIT 1`).bind(org,provider).first();
  return row?.encrypted_key ? decryptAiSecret(env,row.encrypted_key) : "";
}
