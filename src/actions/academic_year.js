// Academic-year rollover port: archive the operational D1 state, advance
// ACADEMIC_YEAR, clear the new-year operational tables, and allow a 3-day
// rollback from the latest archive. No Drive/Spreadsheet dependency remains.
import { resolveOrgId } from "../lib/org.js";
import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

const RESET_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const OP_TABLES = ["grades", "payments", "attendance"];

function denied(){ return {success:false,error:"Droits insuffisants."}; }
function canManage(v){ return !!(v && (v.isMaster || v.isGodMode || v.permissions?.p_settings || v.permissions?.pa_save_settings)); }
function computeNextYear(year){
  const m=String(year||"").trim().match(/^(\d{4})\s*[-–—]\s*(\d{2}|\d{4})$/);
  if(!m) return "";
  const start=Number(m[1]); const end=Number(m[2]);
  const endFull=String(m[2]).length===2 ? Number(String(start).slice(0,2)+m[2]) : end;
  const nextStart=start+1, nextEnd=endFull+1;
  return String(nextStart)+"-"+(String(m[2]).length===2 ? String(nextEnd).slice(-2) : String(nextEnd));
}
async function settingsSnapshot(db){
  const {results}=await db.prepare(`SELECT key,value FROM settings ORDER BY key`).all();
  return results||[];
}
async function tableSnapshot(db, table, orgId){
  const {results}=await db.prepare(`SELECT * FROM ${table} WHERE org_id=?`).bind(orgId).all();
  return results||[];
}
async function latestArchive(db, orgId){
  return db.prepare(`SELECT * FROM academic_year_archives WHERE org_id=? ORDER BY closed_at DESC LIMIT 1`).bind(orgId).first();
}

// {action: "getAvailableAcademicYears"} — port of getAvailableAcademicYears_
// (Code_gs_background-sync__1_.txt ~line 15910). The original read the
// active year from getSaaSSettings_().data.ACADEMIC_YEAR (throwing if
// unset — "Politique Zero Fallback") plus every archived year from the
// 'Archives_Annuelles' Sheet. Both are already real D1 concepts here:
// the `settings` table's ACADEMIC_YEAR key (same table rolloverAcademicYear
// above advances) and `academic_year_archives` (written by that same
// function instead of a separate Sheet) — so this port reads real rows,
// not a stub. Same "throw on missing ACADEMIC_YEAR" behavior preserved.
export async function getAvailableAcademicYears(_data, auth, env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const orgId=await resolveOrgId(env);
    const activeRow=await env.DB.prepare(`SELECT value FROM settings WHERE key='ACADEMIC_YEAR'`).first();
    const active=String(activeRow?.value||"").trim();
    if(!active) return {success:false,error:"Configuration Critique : 'ACADEMIC_YEAR' est manquant dans les paramètres SaaS."};
    const years=new Set([active]);
    const {results}=await env.DB.prepare(`SELECT DISTINCT year FROM academic_year_archives WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all();
    for(const r of results||[]){ const y=String(r.year||"").trim(); if(y) years.add(y); }
    return {success:true,data:[...years].sort().reverse()};
  }catch(e){ return {success:false,error:"Erreur Système : "+e.message}; }
}

export async function getAcademicYearRolloverStatus(_data, auth, env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
    if(!canManage(viewer)) return denied();
    const orgId=await resolveOrgId(env);
    const current=String((await env.DB.prepare(`SELECT value FROM settings WHERE key='ACADEMIC_YEAR'`).first())?.value||"").trim();
    const latest=await latestArchive(env.DB,orgId);
    if(!latest) return {success:true,currentYear:current,hasRollover:false,canReset:false,resetWindowDays:3,message:"Aucune cloture detectee."};
    const closedMs=Date.parse(latest.closed_at); const deadline=closedMs+RESET_WINDOW_MS; const expected=computeNextYear(latest.year); const now=Date.now();
    const canReset=Number.isFinite(closedMs)&&now<=deadline&&expected===current;
    return {success:true,currentYear:current,hasRollover:true,resetWindowDays:3,canReset,closedYear:latest.year,expectedYearAfterRollover:expected,closedAt:latest.closed_at,resetDeadlineAt:new Date(deadline).toISOString(),millisRemaining:Math.max(0,deadline-now),closedBy:latest.closed_by,archiveId:latest.id,snapshotSheet:`D1_ARCHIVE_${latest.year}`,message:canReset?"Reinitialisation possible pendant 3 jours.":(now>deadline?"La fenetre de reinitialisation (3 jours) est expiree.":"La reinitialisation n'est plus applicable pour l'annee active actuelle.")};
  }catch(e){ return {success:false,error:e.message}; }
}

export async function rolloverAcademicYear(_data,auth,env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
    if(!canManage(viewer)) return denied();
    const orgId=await resolveOrgId(env);
    const row=await env.DB.prepare(`SELECT value FROM settings WHERE key='ACADEMIC_YEAR'`).first();
    const cur=String(row?.value||"").trim(); if(!cur) return {success:false,error:"ACADEMIC_YEAR non configure dans Parametres. Definissez-le avant de cloturer l'annee."};
    const next=computeNextYear(cur); if(!next) return {success:false,error:"Format ACADEMIC_YEAR non reconnu. Utilisez par exemple 2026-2027."};
    const existing=await latestArchive(env.DB,orgId);
    if(existing && existing.year===cur) return {success:false,error:"Cette annee scolaire est deja cloturee."};
    const snapshots={settings:await settingsSnapshot(env.DB)};
    for(const t of OP_TABLES) snapshots[t]=await tableSnapshot(env.DB,t,orgId);
    const id="AY-"+crypto.randomUUID(); const ts=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO academic_year_archives(id,org_id,year,next_year,closed_at,closed_by,snapshot_json,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)`)
      .bind(id,orgId,cur,next,ts,String(viewer.email||viewer.userId||"SYSTEM"),JSON.stringify(snapshots),1,ts).run();
    await env.DB.prepare(`UPDATE settings SET value=?,updated_at=? WHERE key='ACADEMIC_YEAR'`).bind(next,ts).run();
    const missing=[];
    for(const t of OP_TABLES){
      await env.DB.prepare(`UPDATE ${t} SET deleted_at=?,updated_at=?,version=version+1 WHERE org_id=? AND deleted_at IS NULL`).bind(ts,ts,orgId).run();
    }
    await writeAudit(env.DB,{table:"academic_year_archives",rowId:id,userId:viewer.id,op:"insert",diff:{year:cur,nextYear:next,clearedTables:OP_TABLES}});
    return {success:true,message:`Annee ${cur} archivee. Bienvenue en ${next}!`,archiveId:id,newYear:next,clearedTables:OP_TABLES,snapshotStored:true,archiveUrl:null};
  }catch(e){ return {success:false,error:e.message}; }
}

export async function resetAcademicYearRollover(_data,auth,env){
  if(!auth?.token) return {success:false,error:"Session invalide."};
  try{
    const viewer=await loadViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
    if(!canManage(viewer)) return denied();
    const orgId=await resolveOrgId(env); const latest=await latestArchive(env.DB,orgId);
    if(!latest) return {success:false,error:"Aucune cloture annuelle detectee."};
    const closedMs=Date.parse(latest.closed_at); const deadline=closedMs+RESET_WINDOW_MS;
    if(Date.now()>deadline) return {success:false,error:"La fenetre de reinitialisation (3 jours) est expiree."};
    const current=String((await env.DB.prepare(`SELECT value FROM settings WHERE key='ACADEMIC_YEAR'`).first())?.value||"").trim();
    if(current!==latest.next_year) return {success:false,error:"Reinitialisation refusee: l'annee active ne correspond pas a la derniere cloture."};
    const snap=JSON.parse(latest.snapshot_json||"{}"); const ts=new Date().toISOString();
    // Remove only current-year operational rows, then restore archived rows.
    for(const t of OP_TABLES){
      await env.DB.prepare(`DELETE FROM ${t} WHERE org_id=?`).bind(orgId).run();
      const rows=Array.isArray(snap[t])?snap[t]:[];
      for(const r of rows){
        const cols=Object.keys(r); const qs=cols.map(()=>"?").join(",");
        await env.DB.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${qs})`).bind(...cols.map(c=>r[c])).run();
      }
    }
    for(const item of (snap.settings||[])){
      await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(item.key,item.value,ts).run();
    }
    await writeAudit(env.DB,{table:"academic_year_archives",rowId:latest.id,userId:viewer.id,op:"update",diff:{action:"YEAR_ROLLOVER_RESET",restoredYear:latest.year}});
    return {success:true,message:`Cloture annuelle reinitialisee vers ${latest.year}.`,restoredYear:latest.year,previousCurrentYear:current,restoredTables:OP_TABLES,resetDeadlineAt:new Date(deadline).toISOString()};
  }catch(e){ return {success:false,error:e.message}; }
}
