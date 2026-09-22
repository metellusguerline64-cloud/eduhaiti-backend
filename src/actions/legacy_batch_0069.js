// EduHaïti — Batch 0069: first-login / staff PIN / AI library initialization.
// D1/R2-native compatibility adapters. No Google Sheet/Drive dependency.
import { resolveOrgId } from "../lib/org.js";
import { hashPin } from "../lib/hash.js";
import { loadSessionToken, storeSessionToken } from "../lib/session.js";
import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

const clean = v => String(v ?? "").trim();
const digits = v => clean(v).replace(/\D/g, "");
const now = () => new Date().toISOString();
const admin = v => !!(v && (v.isMaster || v.isGodMode || v.permissions?.p_settings || v.permissions?.pa_save_settings));

async function viewer(env, auth) { return auth?.token ? loadViewer(env, auth) : null; }
async function setting(env, keys, fallback = "") {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) { const r = await env.DB.prepare(`SELECT value FROM settings WHERE key=? LIMIT 1`).bind(k).first(); if (r?.value != null && clean(r.value) !== "") return r.value; }
  return fallback;
}

export async function loginWithIdAndPin(data, _auth, env) {
  try {
    const userId = clean(data?.userId || data?.id || data?.matricule || data?.empId);
    const pin = clean(data?.pin || data?.password);
    if (!userId || !pin) return { success:false, message:"Identifiants incorrects." };
    if (pin.length < 4) return { success:false, message:"PIN trop court (minimum 4 chiffres)." };
    const prefix = String(await setting(env, ["STAFF_ID_PREFIX", "SYSTEM_ID_PREFIX"], "MT")).toUpperCase();
    const ids = new Set([userId.toUpperCase(), digits(userId), `${prefix}${digits(userId)}`, `${prefix}${digits(userId).padStart(4,"0")}`]);
    if (userId.toUpperCase().startsWith(prefix)) ids.add(userId.slice(prefix.length).toUpperCase());
    const { results=[] } = await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL`).all();
    const candidates = results.filter(r => ids.has(clean(r.user_id).toUpperCase()) || ids.has(clean(r.id).toUpperCase()));
    if (!candidates.length) return { success:false, message:"Matricule ou PIN incorrect." };
    const hp = await hashPin(pin);
    const match = r => clean(r.password_hash).toLowerCase() === hp.toLowerCase() || clean(r.password_hash) === pin;
    let user = candidates.find(r => match(r) && Number(r.active) !== 0) || candidates.find(match);
    if (!user) return { success:false, message:"Matricule ou PIN incorrect." };
    if (Number(user.active) === 0) return { success:false, message:"Compte suspendu. Contactez votre administrateur." };
    if (Number(user.reset_required) === 1) return { success:false, message:"PIN non encore configuré. Utilisez la première connexion par email." };
    const token = crypto.randomUUID();
    await storeSessionToken(env.DB, token, { userId:user.user_id || user.id, email:user.email || "", role:user.role || "STAFF", orgId:await resolveOrgId(env) }, 86400);
    await env.DB.prepare(`UPDATE users SET last_login_at=?,updated_at=? WHERE id=?`).bind(now(),now(),user.id).run();
    return { success:true, status:"AUTHORIZED", token };
  } catch(e) { return { success:false, message:"Erreur: "+e.message }; }
}

export async function setupStaffPin(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return { success:false, error:"Session invalide ou expirée." };
  const pin = clean(data?.pin || data?.newPin);
  if (!/^\d{4,}$/.test(pin)) return { success:false, error:"PIN invalide (minimum 4 chiffres)." };
  const row = await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND (id=? OR user_id=? OR LOWER(email)=?)`).bind(v.id || v.userId, v.id || v.userId, clean(v.email).toLowerCase()).first();
  if (!row) return { success:false,error:"Utilisateur introuvable." };
  await env.DB.prepare(`UPDATE users SET password_hash=?,reset_required=0,version=version+1,updated_at=? WHERE id=?`).bind(await hashPin(pin),now(),row.id).run();
  await writeAudit(env.DB,{table:"users",rowId:row.id,userId:v.id,op:"setup_staff_pin",diff:{resetRequired:false}});
  return { success:true,message:"PIN activé avec succès." };
}

function maskEmail(email) { const [a,b] = clean(email).split("@"); return b ? `${a.slice(0,2)}***@${b}` : "***"; }
export async function sendEmailVerification(_data, auth, env) {
  const v = await viewer(env, auth);
  if (!v || !v.email) return { success:false,error:"Session invalide ou email absent." };
  const otp = String(Math.floor(100000 + Math.random()*900000));
  const expires = Date.now()+600000;
  await env.DB.prepare(`INSERT INTO email_otps(token_hash,email,otp_hash,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET email=excluded.email,otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,created_at=excluded.created_at`).bind(auth.token, v.email, await hashPin(otp), expires, now()).run();
  const webhook = clean(env.EMAIL_WEBHOOK_URL);
  if (!webhook) return { success:false,error:"Envoi email non configuré : EMAIL_WEBHOOK_URL manquant.",maskedEmail:maskEmail(v.email) };
  try {
    const resp = await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({to:v.email,subject:`[${env.SCHOOL_NAME||"Meigens"}] Code de vérification : ${otp}`,text:`Bonjour ${v.name||v.email.split("@")[0]},\n\nVotre code de vérification est : ${otp}\n\nCe code expire dans 10 minutes.`})});
    if (!resp.ok) throw new Error(`Email webhook HTTP ${resp.status}`);
    return { success:true,maskedEmail:maskEmail(v.email) };
  } catch(e) { return { success:false,error:"Impossible d'envoyer l'email : "+e.message }; }
}

export async function verifyEmailOTP(data, auth, env) {
  if (!auth?.token) return { success:false,error:"Session invalide." };
  const otp = clean(typeof data === "string" ? data : data?.otp || data?.code);
  const row = await env.DB.prepare(`SELECT * FROM email_otps WHERE token_hash=? LIMIT 1`).bind(auth.token).first();
  if (!row || Number(row.expires_at) < Date.now()) return { success:false,error:'Code expiré. Cliquez sur "Renvoyer le code".' };
  if (clean(await hashPin(otp)).toLowerCase() !== clean(row.otp_hash).toLowerCase()) return { success:false,error:"Code incorrect. Vérifiez et réessayez." };
  await env.DB.prepare(`DELETE FROM email_otps WHERE token_hash=?`).bind(auth.token).run();
  return { success:true };
}

const AI_DATASETS = ["cycles","levels","subjects","branches","questions","defaults"];
export async function ensureAiConfigurationLibrarySheets(_data, auth, env) {
  const v = await viewer(env,auth); if (!v || !admin(v)) return {success:false,error:"Droits insuffisants."};
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_configuration_library (org_id TEXT NOT NULL,dataset TEXT NOT NULL,row_no INTEGER NOT NULL,row_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,dataset,row_no))`).run();
  return {success:true,datasets:AI_DATASETS};
}
export async function initAiConfigurationLibrary(data, auth, env) {
  const base = await ensureAiConfigurationLibrarySheets(data,auth,env); if (!base.success) return base;
  const orgId = await resolveOrgId(env); const force=!!data?.force;
  const summary={};
  for (const ds of AI_DATASETS) {
    const count = await env.DB.prepare(`SELECT COUNT(*) c FROM ai_configuration_library WHERE org_id=? AND dataset=?`).bind(orgId,ds).first();
    if (force) await env.DB.prepare(`DELETE FROM ai_configuration_library WHERE org_id=? AND dataset=?`).bind(orgId,ds).run();
    summary[ds]={dataset:ds,seeded:force || !Number(count?.c||0),rows:Number(force?0:count?.c||0)};
  }
  return {success:true,target:"d1",summary,message:"Bibliothèque de configuration IA initialisée dans D1."};
}
export async function initAiMasterSheets(data, auth, env) {
  const v=await viewer(env,auth); if(!v || !admin(v)) return {success:false,error:"Droits insuffisants."};
  return initAiConfigurationLibrary(data||{force:true},auth,env);
}
export async function forceInitAiMasterSheets(data, auth, env) {
  const v=await viewer(env,auth); if(!v || !admin(v)) return {success:false,error:"Droits insuffisants."};
  return initAiConfigurationLibrary({...data,force:true},auth,env);
}
