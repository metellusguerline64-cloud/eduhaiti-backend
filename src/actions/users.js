import { hashPin } from "../lib/hash.js";
import { loadSessionToken, revokeSessionsForUser } from "../lib/session.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { checkActionPermission } from "../lib/permissions.js";

function parseJson(v, fallback={}) { try { const x=JSON.parse(v||""); return x && typeof x==="object" ? x : fallback; } catch { return fallback; } }
async function currentViewer(env, auth) {
  if(!auth?.token) return null; const s=await loadSessionToken(env.DB,auth.token); if(!s) return null;
  return env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND id=?`).bind(s.userId).first();
}
function canUserAction(viewer, action) {
  const normalized={...viewer,isMaster:!!(viewer?.isMaster||Number(viewer?.is_master)===1),isGodMode:!!(viewer?.isGodMode||Number(viewer?.is_god_mode)===1)};
  return checkActionPermission(normalized, action).allowed;
}

const MAX_USER_PHOTO_CHARS=48000;
function publicUser(r) {
  return { permissions:parseJson(r.permissions_json), userId:r.user_id||r.id, name:r.name||"", email:r.email||"", role:r.role||"Staff", active:Number(r.active)!==0, isTeacher:Number(r.is_teacher)===1, photo:r.photo_url||"", assignedSubjects:parseJson(r.assigned_subjects), assignments:parseJson(r.assigned_subjects), isReadOnly:!!parseJson(r.permissions_json).isReadOnly, payMode:(r.pay_mode||"").toUpperCase(), payRate:Number(r.pay_rate)||0, payFixedSalary:Number(r.pay_fixed_salary)||0, phone:r.phone||"", startDate:r.start_date||"" };
}
export async function getAllAdminUsers(_data, auth, env) {
  if(!auth?.token) return [];
  const viewer=await currentViewer(env,auth); if(!viewer) return [];
  if(!canUserAction(viewer,"getAllAdminUsers")) return [];
  const orgId=await resolveOrgId(env); // establishes tenant context
  void orgId;
  const {results}=await env.DB.prepare(`SELECT id,user_id,email,username,name,role,active,permissions_json,is_god_mode,is_teacher,assigned_subjects,photo_url,pay_mode,pay_rate,pay_fixed_salary,phone,start_date FROM users WHERE deleted_at IS NULL ORDER BY name,email`).all();
  return (results||[]).filter(r=>r.email && String(r.email).includes("@")).map(publicUser);
}
export async function updateUserRoleAndPerms(data, auth, env) {
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
  if(!canUserAction(viewer,"updateUserRoleAndPerms")) return {success:false,error:"Droits insuffisants."};
  const d=data||{}; const email=String(d.email||"").trim().toLowerCase(); const lookup=String(d.empId||d.userId||d.id||"").trim();
  if(!email && !lookup) return {success:false,error:"Identifiant utilisateur manquant."};
  let row=lookup ? await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND (user_id=? OR id=?)`).bind(lookup,lookup).first() : null;
  if(!row && email) row=await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND LOWER(email)=?`).bind(email).first();
  if(row && Number(row.is_god_mode)===1 && !Number(viewer.is_master)) return {success:false,error:"Compte GodMode protégé. Admin master requis."};
  const ts=new Date().toISOString();
  const currentPerms=parseJson(row?.permissions_json);
  const incomingPerms=(d.perms&&typeof d.perms==="object")?{...d.perms}:{};
  const isGodModeAccount=Number(row?.is_god_mode)===1 || currentPerms.isGodMode===true;
  if(isGodModeAccount && !incomingPerms.isGodMode) incomingPerms.isGodMode=true;
  const perms=JSON.stringify(incomingPerms);
  const assigned=JSON.stringify(d.assignments!==undefined?d.assignments:parseJson(row?.assigned_subjects));
  const payMode=String(d.payMode||"").trim().toUpperCase(); const hasPay=payMode==="HOURLY"||payMode==="FIXED";
  const hasPhoto=Object.prototype.hasOwnProperty.call(d,"photo")||Object.prototype.hasOwnProperty.call(d,"photoUrl")||Object.prototype.hasOwnProperty.call(d,"avatarUrl")||Object.prototype.hasOwnProperty.call(d,"PhotoURL");
  const incomingPhoto=String(d.photo||d.photoUrl||d.avatarUrl||d.PhotoURL||"").trim();
  const photoTooLarge=hasPhoto && incomingPhoto.length>MAX_USER_PHOTO_CHARS;
  const photoValue=photoTooLarge?String(row?.photo_url||""):incomingPhoto;
  const fields={ user_id:String(d.empId||d.userId||d.id||row?.user_id||("MT"+String(Date.now()).slice(-4))), name:String(d.name||row?.name||""), email:email||row?.email||"", role:isGodModeAccount?"ADMIN":String(d.role||row?.role||"Staff"), permissions_json:perms, is_god_mode:isGodModeAccount?1:(incomingPerms.isGodMode?1:0), is_teacher:d.isTeacher?1:0, assigned_subjects:assigned, photo_url:photoValue||(!hasPhoto?String(row?.photo_url||""):""), pay_mode:hasPay?payMode:(row?.pay_mode||""), pay_rate:hasPay&&payMode==="HOURLY"?Number(d.payRate)||0:(hasPay?0:Number(row?.pay_rate)||0), pay_fixed_salary:hasPay&&payMode==="FIXED"?Number(d.payFixedSalary)||0:(hasPay?0:Number(row?.pay_fixed_salary)||0), phone:Object.hasOwn(d,"phone")?String(d.phone||""):String(row?.phone||""), start_date:Object.hasOwn(d,"startDate")?String(d.startDate||""):String(row?.start_date||""), updated_at:ts };
  if(row) {
    if(d.password) {
      const passwordHash = await hashPin(String(d.password));
      await env.DB.prepare(`UPDATE users SET user_id=?,name=?,email=?,role=?,permissions_json=?,is_god_mode=?,is_teacher=?,assigned_subjects=?,photo_url=?,pay_mode=?,pay_rate=?,pay_fixed_salary=?,phone=?,start_date=?,password_hash=?,reset_required=1,version=version+1,updated_at=? WHERE id=?`).bind(fields.user_id,fields.name,fields.email,fields.role,fields.permissions_json,fields.is_god_mode,fields.is_teacher,fields.assigned_subjects,fields.photo_url,fields.pay_mode,fields.pay_rate,fields.pay_fixed_salary,fields.phone,fields.start_date,passwordHash,fields.updated_at,row.id).run();
      await revokeSessionsForUser(env.DB,row.id);
    } else {
      await env.DB.prepare(`UPDATE users SET user_id=?,name=?,email=?,role=?,permissions_json=?,is_god_mode=?,is_teacher=?,assigned_subjects=?,photo_url=?,pay_mode=?,pay_rate=?,pay_fixed_salary=?,phone=?,start_date=?,version=version+1,updated_at=? WHERE id=?`).bind(fields.user_id,fields.name,fields.email,fields.role,fields.permissions_json,fields.is_god_mode,fields.is_teacher,fields.assigned_subjects,fields.photo_url,fields.pay_mode,fields.pay_rate,fields.pay_fixed_salary,fields.phone,fields.start_date,fields.updated_at,row.id).run();
    }
  } else {
    const password=await hashPin(String(d.password||"123456"));
    await env.DB.prepare(`INSERT INTO users(id,user_id,email,name,role,permissions_json,is_god_mode,is_teacher,assigned_subjects,photo_url,pay_mode,pay_rate,pay_fixed_salary,phone,start_date,password_hash,active,reset_required,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,1,?)`).bind(crypto.randomUUID(),fields.user_id,fields.email,fields.name,fields.role,fields.permissions_json,fields.is_god_mode,fields.is_teacher,fields.assigned_subjects,fields.photo_url,fields.pay_mode,fields.pay_rate,fields.pay_fixed_salary,fields.phone,fields.start_date,password,ts).run();
  }
  await writeAudit(env.DB,{table:"users",rowId:row?.id||fields.user_id,userId:viewer.id,op:row?"update":"insert",diff:{userId:fields.user_id,email:fields.email,role:fields.role}});
  return {success:true,message:"Collaborateur enregistré : "+fields.user_id,warning:photoTooLarge?"Photo ignorée: taille trop grande pour la sauvegarde utilisateur.":""};
}
export async function resetUserPassword(data, auth, env) {
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
  if(!canUserAction(viewer,"resetUserPassword")) return {success:false,error:"Droits insuffisants."};
  const id=String(typeof data==="string"?data:(data?.email||data?.userId||data?.empId||data?.id)||"").trim().toLowerCase(); if(!id) return {success:false,message:"Identifiant utilisateur manquant."};
  const row=await env.DB.prepare(`SELECT id,user_id,email,permissions_json FROM users WHERE deleted_at IS NULL AND (LOWER(email)=? OR LOWER(user_id)=?)`).bind(id,id).first();
  if(!row) return {success:false,message:"Utilisateur introuvable."};
  const perms=parseJson(row.permissions_json); if(perms.isReadOnly&&!perms.isGodMode) return {success:false,error:"Compte interne protégé en lecture seule."};
  await env.DB.prepare(`UPDATE users SET password_hash=?,reset_required=1,version=version+1,updated_at=? WHERE id=?`).bind(await hashPin("123456"),new Date().toISOString(),row.id).run(); await revokeSessionsForUser(env.DB,row.id);
  await writeAudit(env.DB,{table:"users",rowId:row.id,userId:viewer.id,op:"reset_password",diff:{}});
  return {success:true,defaultPassword:"123456",message:"Mot de passe réinitialisé au mot de passe par défaut."};
}
export async function toggleGodMode(data, auth, env) {
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide"}; if(!canUserAction(viewer,"toggleGodMode")) return {success:false,error:"Access denied. Admin only."};
  const email=String(data?.email||"").trim().toLowerCase(); if(!email) return {success:false,error:"Email manquant"};
  const row=await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND LOWER(email)=?`).bind(email).first(); if(!row) return {success:false,error:"User not found: "+email};
  const perms=parseJson(row.permissions_json); if(perms.isReadOnly&&!perms.isGodMode) return {success:false,error:"Compte interne protégé en lecture seule."};
  const enabled=!Boolean(perms.isGodMode); perms.isGodMode=enabled;
  await env.DB.prepare(`UPDATE users SET permissions_json=?,is_god_mode=?,version=version+1,updated_at=? WHERE id=?`).bind(JSON.stringify(perms),enabled?1:0,new Date().toISOString(),row.id).run(); await revokeSessionsForUser(env.DB,row.id);
  await writeAudit(env.DB,{table:"users",rowId:row.id,userId:viewer.id,op:"godmode_toggled",diff:{targetEmail:email,newState:enabled?"ENABLED":"DISABLED"}});
  return {success:true,message:"Godmode "+(enabled?"enabled":"disabled")+" for "+email,godmodeEnabled:enabled};
}


export async function getStaffList(_data, auth, env) {
  return getAllAdminUsers(_data, auth, env);
}

export async function getStaffManagementData(_data, auth, env) {
  if (!auth?.token) return { success:false, error:"Session invalide." };
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
  if(!canUserAction(viewer,"getStaffManagementData")) return {success:false,error:"Droits insuffisants."};
  const users=await getAllAdminUsers(_data,auth,env);
  const {results=[]}=await env.DB.prepare(`SELECT id,user_id,name,email,role FROM users WHERE deleted_at IS NULL AND email IS NOT NULL AND email != ''`).all();
  const invalidUsers=(results||[]).filter(r=>!String(r.email||'').includes('@')).map(r=>({userId:r.user_id||r.id,name:r.name||'',email:r.email||'',role:r.role||''}));
  return {success:true,users,staff:users,invalidUsers};
}

export async function saveStaffAccess(data, auth, env) {
  return updateUserRoleAndPerms(data,auth,env);
}

export async function toggleUserActiveState(data, auth, env) {
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
  if(!canUserAction(viewer,"toggleUserActiveState")) return {success:false,error:"Droits insuffisants."};
  const identifier=String(typeof data==='string'?data:(data?.identifier||data?.email||data?.userId||data?.empId||data?.id)||'').trim().toLowerCase();
  if(!identifier) return {success:false,message:"Identifiant utilisateur manquant."};
  const row=await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND (LOWER(email)=? OR LOWER(user_id)=? OR LOWER(id)=?)`).bind(identifier,identifier,identifier).first();
  if(!row) return {success:false,message:"Utilisateur introuvable."};
  const perms=parseJson(row.permissions_json); if(perms.isReadOnly && !perms.isGodMode) return {success:false,error:"Compte interne protégé en lecture seule."};
  const target = data && typeof data==='object' && data.deactivate!==undefined ? !Boolean(data.deactivate) : data && typeof data==='object' && data.active!==undefined ? Boolean(data.active) : data && typeof data==='object' && data.isActive!==undefined ? Boolean(data.isActive) : data && typeof data==='object' && data.status!==undefined ? (String(data.status).toUpperCase()!=='FALSE') : false;
  await env.DB.prepare(`UPDATE users SET active=?,version=version+1,updated_at=? WHERE id=?`).bind(target?1:0,new Date().toISOString(),row.id).run();
  if(!target) await revokeSessionsForUser(env.DB,row.id);
  await writeAudit(env.DB,{table:'users',rowId:row.id,userId:viewer.id,op:'toggle_active',diff:{active:target}});
  return {success:true,active:target};
}

export async function removeUserAccess(data, auth, env) {
  const viewer=await currentViewer(env,auth); if(!viewer) return {success:false,error:"Session invalide."};
  if(!canUserAction(viewer,"removeUserAccess")) return {success:false,error:"Droits insuffisants."};
  const identifier=String(typeof data==='string'?data:(data?.identifier||data?.email||data?.userId||data?.empId||data?.id)||'').trim().toLowerCase();
  if(!identifier) return {success:false,message:"Identifiant utilisateur manquant."};
  const row=await env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND (LOWER(email)=? OR LOWER(user_id)=? OR LOWER(id)=?)`).bind(identifier,identifier,identifier).first();
  if(!row) return {success:false,message:"Utilisateur introuvable."};
  const perms=parseJson(row.permissions_json); if(perms.isReadOnly && !perms.isGodMode) return {success:false,error:"Compte interne protégé en lecture seule."};
  await env.DB.prepare(`UPDATE users SET deleted_at=?,active=0,version=version+1,updated_at=? WHERE id=?`).bind(new Date().toISOString(),new Date().toISOString(),row.id).run();
  await revokeSessionsForUser(env.DB,row.id);
  await writeAudit(env.DB,{table:'users',rowId:row.id,userId:viewer.id,op:'remove_access',diff:{userId:row.user_id||row.id,email:row.email||''}});
  return {success:true};
}
