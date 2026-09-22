import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

async function viewer(env, auth) { return auth?.token ? await loadViewer(env, auth) : null; }
function admin(v) { return !!(v && (v.isMaster || v.isGodMode || v.permissions?.pa_save_settings || v.permissions?.p_settings)); }

function normalizePlan(value) {
  return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}
function isLifetimePlan(value) {
  const p = normalizePlan(value);
  return !!p && (p.includes("LIFETIME") || p.includes("A VIE") || p.includes("VIE"));
}
function evaluateAccountStatus(row, nowMs = Date.now()) {
  const plan = String(row?.plan || "").trim();
  const currentActive = String(row?.status || "ACTIVE").toUpperCase() === "ACTIVE";
  const expiry = row?.expiration_date ? Date.parse(String(row.expiration_date)) : NaN;
  let nextActive = currentActive;
  let reason = "UNCHANGED";

  if (isLifetimePlan(plan)) {
    nextActive = true;
    reason = "LIFETIME_PLAN";
  } else if (!Number.isNaN(expiry)) {
    nextActive = expiry >= nowMs;
    reason = nextActive ? "VALID_UNTIL_DATE" : "EXPIRED";
  } else {
    reason = currentActive ? "NO_EXPIRY_ACTIVE" : "NO_EXPIRY_INACTIVE";
  }
  return { plan, currentActive, nextActive, reason };
}

// D1 port of Code.gs checkAndUpdateAccountStatus_: the retired Register sheet
// is replaced by MASTER_DB.orgs. A single-org sync may target id/businessId/
// subdomain; {all:true} is reserved for master/godmode. Status changes are
// audited and the response keeps the old reviewed/changed/data contract.
export async function checkAndUpdateAccountStatus(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return { success: false, error: "Session invalide." };
  if (!env.MASTER_DB) return { success: false, error: "Base Master non configurée." };

  const runAll = data?.all === true || String(data?.scope || "").toLowerCase() === "all";
  if (runAll && !(v.isMaster || v.isGodMode)) {
    return { success: false, error: "Seul un administrateur master peut synchroniser tous les comptes." };
  }

  const target = String(data?.orgId || data?.schoolId || data?.businessId || data?.subdomain || "").trim();
  let rows = [];
  if (runAll || !target) {
    rows = (await env.MASTER_DB.prepare(`SELECT id,business_id,subdomain,business_name,plan,status,expiration_date FROM orgs WHERE deleted_at IS NULL ORDER BY business_name`).all()).results || [];
  } else {
    const row = await env.MASTER_DB.prepare(
      `SELECT id,business_id,subdomain,business_name,plan,status,expiration_date
       FROM orgs WHERE deleted_at IS NULL AND (id=? OR business_id=? OR subdomain=?) LIMIT 1`
    ).bind(target, target, target.toLowerCase()).first();
    if (row) rows = [row];
  }

  if (!rows.length) {
    return { success: false, error: runAll ? "Aucune ligne de compte valide." : "Aucun compte trouvé pour cet identifiant." };
  }

  const now = Date.now();
  const updates = [];
  for (const row of rows) {
    const result = evaluateAccountStatus(row, now);
    const nextStatus = result.nextActive ? "ACTIVE" : "SUSPENDED";
    const changed = String(row.status || "ACTIVE").toUpperCase() !== nextStatus;
    if (changed) {
      await env.MASTER_DB.prepare(`UPDATE orgs SET status=?,updated_at=? WHERE id=?`).bind(nextStatus, new Date().toISOString(), row.id).run();
    }
    updates.push({
      id: row.id,
      businessId: row.business_id,
      subdomain: row.subdomain,
      businessName: row.business_name,
      previousStatus: String(row.status || "ACTIVE").toUpperCase(),
      nextStatus,
      changed,
      plan: result.plan,
      expirationDate: row.expiration_date || "",
      reason: result.reason,
    });
  }

  await writeAudit(env.DB, {
    table: "orgs",
    rowId: runAll ? "ALL_ACCOUNTS" : rows[0].id,
    userId: v.id || v.userId || null,
    deviceId: auth?.deviceId || null,
    op: "ACCOUNT_STATUS_SYNC",
    diff: { scope: runAll ? "ALL" : "SINGLE", reviewed: updates.length, changed: updates.filter(x => x.changed).length },
  });

  return {
    success: true,
    scope: runAll ? "ALL" : "SINGLE",
    reviewed: updates.length,
    changed: updates.filter(x => x.changed).length,
    data: updates,
  };
}

export async function diagnoseSyncIssue(_data, auth, env) {
  const v=await viewer(env,auth); if(!v)return {success:false,error:"Session invalide."};
  const checks=[]; const push=(name,ok,detail)=>checks.push({name,ok,detail});
  try { const r=await env.DB.prepare('SELECT COUNT(*) c FROM students').first(); push('students',true,`rows=${r?.c||0}`); } catch(e){push('students',false,e.message)}
  try { const r=await env.DB.prepare('SELECT COUNT(*) c FROM audit_log').first(); push('audit_log',true,`rows=${r?.c||0}`); } catch(e){push('audit_log',false,e.message)}
  try { await env.DB.prepare('SELECT 1').first(); push('d1',true,'reachable'); } catch(e){push('d1',false,e.message)}
  return {success:checks.every(x=>x.ok),orgId:env.ORG_ID||null,checks,logs:checks.map(x=>`${x.ok?'OK':'ERR'} | ${x.name} | ${x.detail}`)};
}
export async function runAuditMigration(_data,auth,env){const v=await viewer(env,auth);if(!v||!admin(v))return{success:false,error:"Droits insuffisants."};await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`).run();return{success:true,message:"Migration audit D1 terminée."};}
export async function logAudit(data,auth,env){return writeAuditAction(data,auth,env)}
export async function writeAuditLog(data,auth,env){return writeAuditAction(data,auth,env)}
export async function writeAuditLog_(data,auth,env){return writeAuditAction(data,auth,env)}
async function writeAuditAction(data,auth,env){const v=await viewer(env,auth);if(!v)return{success:false,error:"Session invalide."};const d=data&&typeof data==='object'?data:{};const action=String(d.action||d.name||'UNKNOWN_ACTION');const target=String(d.target||d.user||d.studentId||'SYSTEM');await writeAudit(env.DB,{table:'legacy_audit',rowId:target,userId:v.id||v.userId||null,deviceId:auth?.deviceId||null,op:action,diff:{details:d.details||d,permission:d.permission||d.permUsed||'',isError:!!d.isError}});return{success:true};}
export async function purgeExpiredTokens(_data,auth,env){const v=await viewer(env,auth);if(!v||!admin(v))return{success:false,error:"Droits insuffisants."};const r=await env.DB.prepare(`DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?`).bind(new Date().toISOString()).run();return{success:true,deleted:r.meta?.changes||0,kept:0,errors:0};}
export async function getUnifiedDirectory(_data,auth,env){const v=await viewer(env,auth);if(!v)return{success:false,error:'Session invalide.',data:[]};const out=[];const students=(await env.DB.prepare(`SELECT id,student_code,first_name,last_name,current_level FROM students WHERE deleted_at IS NULL ORDER BY last_name,first_name`).all()).results||[];students.forEach(s=>out.push({id:s.student_code||s.id,type:'STUDENT',shortCode:String(s.student_code||s.id).replace(/\D/g,'').slice(-4),name:[s.first_name,s.last_name].filter(Boolean).join(' '),level:s.current_level||'',hasCheckedIn:false,hasCheckedOut:false}));const users=(await env.DB.prepare(`SELECT id,user_id,name,email,role FROM users WHERE deleted_at IS NULL AND email IS NOT NULL AND email!='' ORDER BY name,email`).all()).results||[];users.forEach(u=>out.push({id:u.email||u.user_id||u.id,type:'STAFF',shortCode:String(u.user_id||u.id).replace(/\D/g,'').slice(-4),name:u.name||u.email,level:'STAFF',hasCheckedIn:false,hasCheckedOut:false}));return{success:true,data:out};}
export async function getDownloadPageData(_data,auth,env){const v=await viewer(env,auth);if(!v)return{success:false,error:'Session invalide.'};return{success:true,schoolName:env.SCHOOL_NAME||'',orgId:env.ORG_ID||null,generatedAt:new Date().toISOString()};}
