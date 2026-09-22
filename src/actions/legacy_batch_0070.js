// 0070 — final Code.gs AI configuration actions.
import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { encryptAiSecret } from "../lib/ai_key_store.js";

const admin = v => !!(v && (v.isMaster || v.isGodMode || v.permissions?.pa_save_settings || v.permissions?.p_settings));
const clean = v => String(v ?? "").trim();

export async function getAiConfigurationAssistanceContext(data, auth, env) {
  const v = auth?.token ? await loadViewer(env,auth) : null;
  if (!v) return {success:false,error:"SESSION_EXPIREE"};
  const levelKeys = Array.isArray(data?.levelKeys) ? data.levelKeys.map(clean).filter(Boolean) : [];
  let configured = {};
  const cfg = data?.currentConfig && typeof data.currentConfig === "object" ? data.currentConfig : {};
  for (const [key,raw] of Object.entries(cfg)) {
    if (!/^CURRICULUM_/i.test(key)) continue;
    let chunk=raw; if (typeof chunk === "string") { try { chunk=JSON.parse(chunk); } catch { chunk=null; } }
    if (Array.isArray(chunk) && chunk.length) configured[key.replace(/^CURRICULUM_/i,"").toLowerCase()] = chunk;
    else if (chunk && typeof chunk === "object") for (const [level,items] of Object.entries(chunk)) if (Array.isArray(items)&&items.length) configured[level]=items;
  }
  const org = await resolveOrgId(env); const library={};
  for (const level of levelKeys) {
    const rows=await env.DB.prepare(`SELECT row_json FROM ai_configuration_library WHERE org_id=? AND dataset='subjects' ORDER BY row_no`).bind(org).all();
    const parsed=(rows.results||[]).map(r=>{try{return JSON.parse(r.row_json)}catch{return null}}).filter(Boolean);
    library[level]=parsed.filter(x=>clean(x.levelKey||x.level||x.gradeLevelId||"")===level || !clean(x.levelKey||x.level||x.gradeLevelId||""));
  }
  const missing=levelKeys.filter(k=>!configured[k]);
  const recommendations=levelKeys.map(k=>{if(!configured[k]) return `Niveau ${k} : pas encore configuré. Notre bibliothèque de référence propose ${(library[k]||[]).length} élément(s).`; if((configured[k]||[]).length!==(library[k]||[]).length) return `Niveau ${k} : actuellement ${configured[k].length} élément(s) configuré(s), mais ${(library[k]||[]).length} disponible(s) dans le master.`; return null;}).filter(Boolean);
  return {success:true,data:{requestedLevels:levelKeys,configuredLevels:Object.keys(configured),libraryLevels:Object.keys(library),missingLevels:missing,configured,library,recommendations},message:missing.length?`Configuration secondaire incomplète : ${missing.length}/${levelKeys.length} niveaux manquent. Complétez-la via l'assistant de configuration.`:"Configuration secondaire complète."};
}

export async function saveAiApiKeys(data, auth, env) {
  const v=auth?.token ? await loadViewer(env,auth) : null;
  if(!v) return {success:false,error:"Session invalide."};
  if(!admin(v)) return {success:false,error:"Droits insuffisants."};
  const gemini=clean(data?.gemini), claude=clean(data?.claude);
  if(!gemini&&!claude) return {success:false,error:"Aucune clé fournie."};
  if(!env.AI_CONFIG_ENCRYPTION_KEY) return {success:false,error:"AI_CONFIG_ENCRYPTION_KEY manquant dans les secrets du Worker."};
  const org=await resolveOrgId(env), t=new Date().toISOString();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_provider_keys (org_id TEXT NOT NULL,provider TEXT NOT NULL,encrypted_key TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT,PRIMARY KEY(org_id,provider))`).run();
  if(gemini) await env.DB.prepare(`INSERT INTO ai_provider_keys(org_id,provider,encrypted_key,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(org_id,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(org,"gemini",await encryptAiSecret(env,gemini),t,v.id||v.email||"").run();
  if(claude) await env.DB.prepare(`INSERT INTO ai_provider_keys(org_id,provider,encrypted_key,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(org_id,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(org,"anthropic",await encryptAiSecret(env,claude),t,v.id||v.email||"").run();
  await writeAudit(env.DB,{table:"ai_provider_keys",rowId:org,userId:v.id,op:"SAVE_AI_API_KEYS",diff:{gemini:!!gemini,anthropic:!!claude}});
  return {success:true,configured:{gemini:!!gemini,claude:!!claude},storage:"D1 encrypted"};
}
