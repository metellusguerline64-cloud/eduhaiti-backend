// Complete tenant Settings port.
//
// Code.gs stored school configuration as KEY/VALUE rows in the Settings
// sheet and exposed the same data through both getSaaSSettings/getSettings.
// Cloudflare/D1 keeps the same flat key/value contract in the settings table.
// Structured values are stored as JSON strings and returned as parsed values.
//
// This module deliberately keeps compatibility aliases used by the frontend:
// getSaaSSettings, getSettings, updateSaaSSettings, updateLocalSettings,
// getSettingsHealth and cleanupSettingsDuplicates.

import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { getOrgMasterData } from "../lib/orgBilling.js";

export const REQUIRED_SETTINGS_KEYS = [
  "schoolName", "orgId", "schoolCode", "currentAcademicYear",
  "schoolPhone", "schoolEmail", "schoolAddress",
  "academicStructure", "gradingType", "NUM_PERIODS", "maxScore",
  "passingScore", "PROMOTION_MIN_AVG", "ACTIVE_LEVELS",
  "currency", "TUITION_MODE",
];

// Notifications are delivered exclusively through the application's PWA push channel.
// No SMS, WhatsApp, email, or third-party messaging provider is required.
export const CONDITIONAL_SETTINGS = {};

const CONFIG_SCHEMA = [
  { id:"school_name", label:"Nom de l'établissement", section:"Identité", required:true, keys:["SCHOOL_NAME","schoolName","BUSINESS_NAME","ORG_NAME"] },
  { id:"academic_year", label:"Année scolaire", section:"Académique", required:true, keys:["ACADEMIC_YEAR","CURRENT_ACADEMIC_YEAR","currentAcademicYear"] },
  { id:"num_periods", label:"Nombre de périodes", section:"Académique", required:true, keys:["NUM_PERIODS","TOTAL_TERMS","TERM_COUNT"] },
  { id:"levels", label:"Niveaux d'enseignement", section:"Structure scolaire", required:true, keys:["LEVELS","ACTIVE_LEVELS","levels","activeLevels","SCHOOL_LEVELS","ACADEMIC_LEVELS"] },
  { id:"curriculum", label:"Matières et curriculum", section:"Pédagogie", required:true, keys:["SCHOOL_CURRICULUM"] },
  { id:"grading_format", label:"Format de notation", section:"Évaluation", required:true, keys:["GRADING_FORMAT","gradingType","grading_format","GRADING_SCALE","maxScore","MAX_SCORE","GRADE_MAX"] },
  { id:"currency", label:"Devise", section:"Finance", required:true, keys:["CURRENCY","currency"] },
  { id:"grading_scale", label:"Barème de notation", section:"Évaluation", required:false, keys:["GRADING_SCALE","maxScore"] },
  { id:"pass_mark", label:"Note de passage", section:"Évaluation", required:false, keys:["PASS_MARK","PROMOTION_MIN_AVG","passMark","passingScore"] },
  { id:"tuition_mode", label:"Mode de facturation", section:"Finance", required:false, keys:["TUITION_MODE"] },
  { id:"tuition_amount", label:"Montant des frais", section:"Finance", required:false, keys:["TUITION_AMOUNT_GLOBAL","TUITION_AMOUNT"] },
  { id:"tuition_frequency", label:"Fréquence de paiement", section:"Finance", required:false, keys:["TUITION_FREQUENCY"] },
  { id:"attendance_time", label:"Heure d'entrée", section:"Présence", required:false, keys:["ATTENDANCE_ENTRY_TIME"] },
  { id:"attendance_alert", label:"Seuil d'alerte présence", section:"Présence", required:false, keys:["ATTENDANCE_THRESHOLD","ATTENDANCE_ADMIN_ALERT_MIN"] },
  { id:"school_phone", label:"Téléphone", section:"Identité", required:false, keys:["SCHOOL_PHONE","PHONE","TRANSACTION_PHONE"] },
  { id:"school_email", label:"Email", section:"Identité", required:false, keys:["SCHOOL_EMAIL","EMAIL"] },
  { id:"bulletin_rules", label:"Règles bulletin", section:"Évaluation", required:false, keys:["BULLETIN_DIVISOR_RULES_JSON"] },
];

function denied(){ return {success:false,error:"Droits insuffisants."}; }
function present(v){
  if(v === null || v === undefined) return false;
  if(typeof v === "string" && !v.trim()) return false;
  if(v === "{}" || v === "[]") return false;
  if(typeof v === "object" && Object.keys(v).length === 0) return false;
  return true;
}
function canManage(viewer){
  return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_settings || viewer.permissions?.pa_save_settings));
}
function parseStoredValue(value){
  if(value === null || value === undefined) return value;
  const s=String(value);
  if(s === "TRUE") return true;
  if(s === "FALSE") return false;
  if((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))){
    try{return JSON.parse(s);}catch(_){/* plain string */}
  }
  return value;
}
function serializeValue(value){
  if(value !== null && typeof value === "object") return JSON.stringify(value);
  if(typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if(value === null || value === undefined) return "";
  return String(value);
}
function canonicalize(data){
  const entries=[];
  if(data && typeof data === "object" && data.name){
    entries.push({name:String(data.name).trim(),value:data.value});
  }else if(data && typeof data === "object"){
    for(const [key,value] of Object.entries(data)){
      if(["token","auth","meta","allowEmptyRequired"].includes(key.toLowerCase())) continue;
      const name=String(key).trim(); if(name) entries.push({name,value});
    }
  }
  return entries;
}

async function readSettings(db, targetYear = "", orgId = "") {
  const year = String(targetYear || "").trim();
  // Code.gs resolves historical Settings_<year> snapshots through
  // Archives_Annuelles. D1 stores the same rollover snapshot in
  // academic_year_archives.snapshot_json, so historical reads must use that
  // snapshot instead of silently returning current settings.
  if (year && orgId) {
    const archive = await db.prepare(`SELECT snapshot_json FROM academic_year_archives WHERE org_id=? AND year=? AND deleted_at IS NULL ORDER BY closed_at DESC LIMIT 1`)
      .bind(orgId, year).first();
    if (archive?.snapshot_json) {
      try {
        const snap = JSON.parse(archive.snapshot_json);
        if (Array.isArray(snap?.settings)) return snap.settings.map(r => ({
          key: String(r?.key || "").trim(), value: r?.value, updated_at: r?.updated_at || ""
        })).filter(r => r.key);
      } catch (_) { /* fall through to current settings for malformed archives */ }
    }
  }
  const {results}=await db.prepare(`SELECT key,value,updated_at FROM settings ORDER BY key`).all();
  return results||[];
}

// Direct port of Code.gs's normalizeSaaSSettingsAcademicYear_ (school.js,
// "PATCH 8"). getSaaSSettings_ always ran this on the merged config right
// before caching/returning it, so ACADEMIC_YEAR/NUM_PERIODS end up
// normalized across every key spelling and clamped to [1,5] — including
// the quirk that NUM_PERIODS always ends up defaulted to 4 even when
// nothing configured it, which is why configurationStatus() below can
// report it as "configured" the same way the GAS version did.
function normalizeSaaSSettingsAcademicYear(cfg){
  if(!cfg || typeof cfg !== "object") return cfg;
  const year = cfg.ACADEMIC_YEAR || cfg.academicYear || cfg.CURRENT_ACADEMIC_YEAR
    || cfg.currentAcademicYear || cfg.SCHOOL_YEAR || cfg.schoolYear
    || cfg.annee_scolaire || cfg.ANNEE_SCOLAIRE || "";
  if(year){
    cfg.ACADEMIC_YEAR=String(year).trim();
    cfg.academicYear=cfg.ACADEMIC_YEAR;
    cfg.currentAcademicYear=cfg.ACADEMIC_YEAR;
  }
  const rawPeriods = cfg.NUM_PERIODS || cfg.TOTAL_TERMS || cfg.numPeriods || cfg.totalTerms || 4;
  const parsedPeriods = parseInt(rawPeriods, 10);
  const periodCount = Math.max(1, Math.min(5, isNaN(parsedPeriods) ? 4 : parsedPeriods));
  cfg.NUM_PERIODS=periodCount;
  cfg.numPeriods=periodCount;
  cfg.TOTAL_TERMS=periodCount;
  cfg.totalTerms=periodCount;
  return cfg;
}

function buildMerged(rows, env, orgId, masterData){
  const local={};
  for(const row of rows) local[row.key]=parseStoredValue(row.value);
  // Code.gs precedence: `Object.assign({}, masterData, local)` — the
  // per-org Register row (now MASTER_DB.orgs, see orgBilling.js) is the
  // default layer, and this school's own local Settings values win when
  // set. masterData is undefined/null when MASTER_DB isn't bound (tests,
  // pre-EDGE-0091 envs) — merged then behaves exactly as before.
  let merged={...(masterData||{}),...local};

  // Below is Code.gs's exact getSaaSSettings_ fallback cascade (school.js
  // "PATCH" block right after `let merged = Object.assign(...)`), kept in
  // its original order since later lines (e.g. schoolAddress from
  // SCHOOL_ADDR) depend on earlier ones (e.g. SCHOOL_ADDR from ADDRESS)
  // having already run.
  if(!present(merged.SCHOOL_EMAIL) && present(merged.CONTACTEMAIL)) merged.SCHOOL_EMAIL=merged.CONTACTEMAIL;
  if(!present(merged.SCHOOL_EMAIL) && present(merged.SCHOOLEMAIL)) merged.SCHOOL_EMAIL=merged.SCHOOLEMAIL;
  if(!present(merged.SCHOOL_PHONE) && present(merged.CONTACTPHONE)) merged.SCHOOL_PHONE=merged.CONTACTPHONE;
  if(!present(merged.SCHOOL_PHONE) && present(merged.SCHOOLPHONE)) merged.SCHOOL_PHONE=merged.SCHOOLPHONE;
  if(!present(merged.SCHOOL_NAME) && present(merged.SCHOOLNAME)) merged.SCHOOL_NAME=merged.SCHOOLNAME;
  if(!present(merged.SCHOOL_NAME) && present(merged.BUSINESS_NAME)) merged.SCHOOL_NAME=merged.BUSINESS_NAME;
  if(!present(merged.SCHOOL_ADDR) && present(merged.ADDRESS)) merged.SCHOOL_ADDR=merged.ADDRESS;
  if(!present(merged.SCHOOL_EMAIL) && present(merged.EMAIL)) merged.SCHOOL_EMAIL=merged.EMAIL;
  if(!present(merged.SCHOOL_PHONE) && present(merged.PHONE)) merged.SCHOOL_PHONE=merged.PHONE;
  if(!present(merged.SCHOOL_PHONE) && present(merged.TRANSACTION_PHONE)) merged.SCHOOL_PHONE=merged.TRANSACTION_PHONE;
  if(!present(merged.CONTACT_NAME) && present(merged.NAME)) merged.CONTACT_NAME=merged.NAME;
  // Code.gs: `if (!merged.ORG_ID) merged.ORG_ID = getOrgId_() || '';`
  if(!present(merged.ORG_ID)) merged.ORG_ID=orgId||env?.ORG_ID||"";

  if(!present(merged.schoolName) && present(merged.SCHOOL_NAME)) merged.schoolName=merged.SCHOOL_NAME;
  if(!present(merged.schoolLogo) && present(merged.SCHOOL_LOGO)) merged.schoolLogo=merged.SCHOOL_LOGO;
  if(!present(merged.schoolAddress) && present(merged.SCHOOL_ADDR)) merged.schoolAddress=merged.SCHOOL_ADDR;
  if(!present(merged.schoolEmail) && present(merged.SCHOOL_EMAIL)) merged.schoolEmail=merged.SCHOOL_EMAIL;
  if(!present(merged.schoolPhone) && present(merged.SCHOOL_PHONE)) merged.schoolPhone=merged.SCHOOL_PHONE;
  if(!present(merged.schoolCode) && present(merged.SCHOOL_CODE)) merged.schoolCode=merged.SCHOOL_CODE;
  if(!present(merged.orgId) && present(merged.ORG_ID)) merged.orgId=merged.ORG_ID;
  if(!present(merged.orgType) && present(merged.ORG_TYPE)) merged.orgType=merged.ORG_TYPE;
  if(!present(merged.orgName) && present(merged.ORG_NAME)) merged.orgName=merged.ORG_NAME;
  if(!present(merged.userSpreadsheetId) && present(merged.USER_SPREADSHEET_ID)) merged.userSpreadsheetId=merged.USER_SPREADSHEET_ID;
  if(!present(merged.studentPortalUrl) && present(merged.STUDENT_PORTAL_URL)) merged.studentPortalUrl=merged.STUDENT_PORTAL_URL;
  if(!present(merged.staffAppUrl) && present(merged.STAFF_APP_URL)) merged.staffAppUrl=merged.STAFF_APP_URL;
  if(!present(merged.orgDriveFolderId) && present(merged.ORG_DRIVE_FOLDER_ID)) merged.orgDriveFolderId=merged.ORG_DRIVE_FOLDER_ID;
  if(!present(merged.subscriptionPlan) && present(merged.SUBSCRIPTION_PLAN)) merged.subscriptionPlan=merged.SUBSCRIPTION_PLAN;
  if(!present(merged.expirationDate) && present(merged.EXPIRATION_DATE)) merged.expirationDate=merged.EXPIRATION_DATE;
  if(!present(merged.paymentType) && present(merged.PAYMENT_TYPE)) merged.paymentType=merged.PAYMENT_TYPE;
  if(!present(merged.dateCreated) && present(merged.DATE_CREATED)) merged.dateCreated=merged.DATE_CREATED;
  if(!present(merged.currentAcademicYear) && present(merged.CURRENT_ACADEMIC_YEAR)) merged.currentAcademicYear=merged.CURRENT_ACADEMIC_YEAR;
  // "Principal / director comes from Register column C = NAME" (Code.gs comment, verbatim intent).
  if(present(merged.CONTACT_NAME)) merged.schoolDirector=merged.CONTACT_NAME;
  if(!present(merged.adminProxyEmail) && present(merged.SCHOOL_EMAIL)) merged.adminProxyEmail=merged.SCHOOL_EMAIL;
  // Code.gs exposed the Apps Script deployment exec URL here via
  // ScriptApp.getService().getUrl(); there's no Worker-request-independent
  // equivalent, so this only fires if a WORKER_BASE_URL var is configured
  // (wrangler.toml [vars]) — otherwise it's silently skipped, same as
  // Code.gs's own try/catch did when getService() failed.
  if(!present(merged.SCRIPT_EXEC_URL) && present(env?.WORKER_BASE_URL)){
    merged.SCRIPT_EXEC_URL=env.WORKER_BASE_URL;
    merged.scriptExecUrl=env.WORKER_BASE_URL;
  }

  merged=normalizeSaaSSettingsAcademicYear(merged);

  // Extra alias spellings beyond Code.gs's own list, kept for
  // backward-compat with older/looser Settings key spellings this port
  // has already had to tolerate in the field.
  if(!present(merged.currentAcademicYear) && present(merged.ACADEMICYEAR)) merged.currentAcademicYear=merged.ACADEMICYEAR;
  if(!present(merged.currentAcademicYear) && present(merged.SCHOOLYEAR)) merged.currentAcademicYear=merged.SCHOOLYEAR;
  if(!present(merged.schoolAddress) && present(merged.SCHOOLADDRESS)) merged.schoolAddress=merged.SCHOOLADDRESS;

  return merged;
}

function configurationStatus(conf){
  const cfg={...(conf||{})};
  const has=(keys)=>keys.some(k=>present(cfg[k]));
  const value=(keys)=>{for(const k of keys){if(present(cfg[k])) return typeof cfg[k]==="object"?"[configuré]":String(cfg[k]).slice(0,60);}return "";};
  const configured=[], missingRequired=[], missingOptional=[];
  for(const item of CONFIG_SCHEMA){
    if(has(item.keys)) configured.push(item.label+" : "+value(item.keys));
    else if(item.required) missingRequired.push(item);
    else missingOptional.push(item);
  }
  const total=CONFIG_SCHEMA.length;
  return {
    configuredLines:configured,
    missingRequired,
    missingOptional,
    readinessScore:Math.round((configured.length/total)*100),
    isOperational:missingRequired.length===0,
    nextHint:(missingRequired[0]||missingOptional[0])?.label||null,
    summary:missingRequired.length===0
      ? `Système opérationnel (${configured.length}/${total} paramètres)`
      : `${configured.length}/${total} paramètres configurés — ${missingRequired.length} requis manquants`,
  };
}

export async function getSaaSSettings(data, auth, env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth);
    if(!viewer) return {success:false,error:"Session invalide."};
    const orgId=await resolveOrgId(env);
    const targetYear=String(data?.targetYear || data?.year || "").trim();
    const rows=await readSettings(env.DB,targetYear,orgId);
    const masterData=await getOrgMasterData(env);
    const mergedData=buildMerged(rows,env,orgId,masterData);
    // MonCash credentials are encrypted server-side and are never part of the generic settings payload.
    delete mergedData.MONCASH_CONFIG_ENC;
    mergedData.settingsData={...mergedData};
    mergedData.configurationStatus=configurationStatus(mergedData);
    mergedData.configurationMissingKeys=mergedData.configurationStatus.missingRequired.map(x=>x.keys[0]);
    return {success:true,data:mergedData};
  }catch(e){return {success:false,error:e.message};}
}

export async function getSettings(data,auth,env){ return getSaaSSettings(data,auth,env); }

export async function updateSaaSSettings(data,auth,env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth);
    if(!viewer) return {success:false,error:"Session invalide."};
    if(!canManage(viewer)) return denied();
    const entries=canonicalize(data);
    if(entries.some(e => String(e.name).toUpperCase() === "MONCASH_CONFIG_ENC")) return {success:false,error:"Utilisez saveMonCashConfig pour gérer les credentials MonCash."};
    if(!entries.length) return {success:false,error:"Clé 'name' manquante."};

    if(!data?.allowEmptyRequired){
      const blocked=entries.filter(e=>REQUIRED_SETTINGS_KEYS.includes(e.name)&&!present(e.value)).map(e=>e.name);
      if(blocked.length) return {success:false,error:"Clés essentielles ne peuvent être vidées : "+blocked.join(", "),blocked};
    }

    const oldRows=await readSettings(env.DB);
    const oldMap=Object.fromEntries(oldRows.map(r=>[r.key,r.value]));
    const ts=new Date().toISOString();
    const statements=[];
    for(const entry of entries){
      const value=serializeValue(entry.value);
      statements.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(entry.name,value,ts));
    }
    if(statements.length) await env.DB.batch(statements);

    const orgId=await resolveOrgId(env);
    for(const entry of entries){
      await writeAudit(env.DB,{table:"settings",rowId:entry.name,userId:viewer.id,op:"UPDATE_SETTING",diff:{old:parseStoredValue(oldMap[entry.name]),new:entry.value,orgId}});
    }
    return {success:true,message:entries.length===1?`Sauvegarde : ${entries[0].name}`:`Sauvegarde : ${entries.length} paramètres`,count:entries.length,duplicatesRemoved:0};
  }catch(e){return {success:false,error:e.message};}
}

export async function updateLocalSettings(data,auth,env){ return updateSaaSSettings(data,auth,env); }

export async function getSettingsHealth(_data,auth,env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth);
    if(!viewer) return {success:false,error:"Session invalide."};
    const rows=await readSettings(env.DB);
    const rowsByKey={}, valueByKey={};
    for(const row of rows){
      (rowsByKey[row.key] ||= []).push(row);
      if(present(row.value) || !(row.key in valueByKey)) valueByKey[row.key]=parseStoredValue(row.value);
    }
    const duplicates={};
    for(const [key,list] of Object.entries(rowsByKey)) if(list.length>1) duplicates[key]=list.length;
    const missingRequired=REQUIRED_SETTINGS_KEYS.filter(k=>!present(valueByKey[k]));
    const missingConditional=[];
    for(const [trigger,deps] of Object.entries(CONDITIONAL_SETTINGS)){
      if(String(valueByKey[trigger]||"").toUpperCase()!=="TRUE") continue;
      for(const dep of deps) if(!present(valueByKey[dep]) && !missingConditional.includes(dep)) missingConditional.push(`${dep} (requis car ${trigger}=TRUE)`);
    }
    const orgId=await resolveOrgId(env);
    const masterData=await getOrgMasterData(env);
    return {success:true,totalKeys:Object.keys(rowsByKey).length,duplicates,duplicatesRemoved:0,missingRequired,missingConditional,healthy:missingRequired.length===0&&Object.keys(duplicates).length===0,configurationStatus:configurationStatus(buildMerged(rows,env,orgId,masterData))};
  }catch(e){return {success:false,error:e.message};}
}

export async function cleanupSettingsDuplicates(_data,auth,env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth);
    if(!viewer) return {success:false,error:"Session invalide."};
    if(!canManage(viewer)) return denied();
    const rows=await readSettings(env.DB);
    const by={};
    for(const row of rows) (by[row.key] ||= []).push(row);
    let removed=0;
    for(const [key,list] of Object.entries(by)){
      if(list.length<=1) continue;
      // Keep the newest row by updated_at, matching the intent of the GAS
      // health tool while preserving the most recently saved configuration.
      list.sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
      const keep=list[0];
      for(const row of list.slice(1)){
        await env.DB.prepare(`DELETE FROM settings WHERE key=? AND updated_at=?`).bind(key,row.updated_at).run();
        removed++;
      }
      await writeAudit(env.DB,{table:"settings",rowId:key,userId:viewer.id,op:"CLEANUP_SETTING_DUPLICATES",diff:{keptUpdatedAt:keep.updated_at,removed: list.length-1}});
    }
    const health=await getSettingsHealth({},auth,env);
    return {...health,duplicatesRemoved:removed};
  }catch(e){return {success:false,error:e.message};}
}
