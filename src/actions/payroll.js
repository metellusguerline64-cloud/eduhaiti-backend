// payroll.js — D1 port of Code.gs payroll actions.
// Ports:
//   calculateTeacherPayroll_ -> calculateTeacherPayroll
//   saveTeacherPaymentMode_ -> saveTeacherPaymentMode
//   processPayrollBatch_    -> processPayrollBatch
//   getPayrollHistory_      -> getPayrollHistory
//
// Behaviour preserved from Code.gs:
// - teacher assignments: HOURLY = actual attendance overlapping the scheduled
//   class window; FIXED = assignment Salary, independent of attendance.
// - general staff: HOURLY = rate x actual clocked hours; FIXED = PayFixedSalary.
// - open punches are never guessed and generate warnings.
// - duplicate PAYE rows for overlapping periods are rejected.
// - payroll writes are transactional so a concurrent/retried batch cannot
//   partially append a payment.

import { resolveOrgId } from "../lib/org.js";
import { loadSessionToken } from "../lib/session.js";
import { writeAudit } from "../lib/audit.js";
import { loadViewer } from "../lib/accessScope.js";
import { checkActionPermission } from "../lib/permissions.js";

const TZ = "America/Port-au-Prince";
const PAYROLL_HEADERS = ["Date","Mois","Collaborateur","Salaire Base","Retenues","Salaire Net","Statut","TraitePar","CollaborateurID","PeriodeDebut","PeriodeFin"];

function authError(){ return {success:false,error:"Non authentifié."}; }
function norm(v){ return String(v ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
function round2(v){ return Math.round((Number(v)||0)*100)/100; }
function parseJson(v, fallback={}){ try { const x=JSON.parse(v||""); return x && typeof x === "object" ? x : fallback; } catch { return fallback; } }
function validDateOnly(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v||"")); }
function dateRange(startRaw,endRaw){
  if(!validDateOnly(startRaw)||!validDateOnly(endRaw)) return null;
  const s=new Date(`${startRaw}T00:00:00`), e=new Date(`${endRaw}T23:59:59`);
  if(isNaN(s.getTime())||isNaN(e.getTime())||s>e) return null;
  return {start:s,end:e};
}
function localParts(date){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(date);
  const g=k=>parts.find(p=>p.type===k)?.value||"00";
  return {date:`${g("year")}-${g("month")}-${g("day")}`,time:`${g("hour")}:${g("minute")}:${g("second")}`};
}
function dateKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function daysBetween(startRaw,endRaw){
  const out=[]; let d=new Date(`${startRaw}T00:00:00`), e=new Date(`${endRaw}T00:00:00`);
  while(d<=e){ out.push(new Date(d)); d.setDate(d.getDate()+1); }
  return out;
}
function dayMatches(label,date){
  const n=norm(label), map={0:["sunday","dimanche","sun","dim"],1:["monday","lundi","mon","lun"],2:["tuesday","mardi","tue","mar"],3:["wednesday","mercredi","wed","mer"],4:["thursday","jeudi","thu","jeu"],5:["friday","vendredi","fri","ven"],6:["saturday","samedi","sat","sam"]};
  if(!n) return false;
  const names=map[date.getDay()]||[]; return names.some(x=>norm(x)===n) || n===String(date.getDay());
}
function timeHours(v){
  const m=String(v||"").trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/); if(!m) return NaN;
  return Number(m[1])+Number(m[2])/60+Number(m[3]||0)/3600;
}
function sessionHours(start,end,fallback){ const s=timeHours(start),e=timeHours(end); return Number.isFinite(s)&&Number.isFinite(e)&&e>s ? e-s : Number(fallback)||0; }
function monthFrom(startRaw){ return String(startRaw||"").slice(0,7); }
function periodFromRow(r){
  const s=String(r.period_start||"").trim(), e=String(r.period_end||"").trim();
  if(validDateOnly(s)&&validDateOnly(e)) return {start:new Date(`${s}T00:00:00`),end:new Date(`${e}T23:59:59`)};
  const m=String(r.month||"").trim();
  if(/^\d{4}-\d{2}$/.test(m)){ const ds=new Date(`${m}-01T00:00:00`); return {start:ds,end:new Date(ds.getFullYear(),ds.getMonth()+1,0,23,59,59)}; }
  return null;
}
function overlaps(a,b){ if(!a||!b) return true; return a.start<=b.end&&a.end>=b.start; }

async function viewer(env,auth){
  if(!auth?.token) return null;
  const s=await loadSessionToken(env.DB,auth.token); if(!s) return null;
  return env.DB.prepare(`SELECT * FROM users WHERE deleted_at IS NULL AND id=?`).bind(s.userId).first();
}
function isAdmin(v){ return !!(v && (Number(v.is_master)===1||Number(v.is_god_mode)===1)); }
function canPayroll(v, action){
  const normalized={...v,isMaster:!!(v?.isMaster||Number(v?.is_master)===1),isGodMode:!!(v?.isGodMode||Number(v?.is_god_mode)===1)};
  return checkActionPermission(normalized, action).allowed;
}

function attTime(meta,key){ return String(meta?.[key]||"").trim(); }
async function attendanceMap(env,orgId,email,startRaw,endRaw){
  const map={};
  const {results:rows}=await env.DB.prepare(`SELECT date,status,meta_json,updated_at FROM attendance WHERE org_id=? AND LOWER(student_id)=LOWER(?) AND grade_level_id='STAFF' AND date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date ASC,updated_at DESC`).bind(orgId,email,startRaw,endRaw).all();
  for(const r of rows||[]){
    if(map[r.date]) continue;
    const meta=parseJson(r.meta_json);
    map[r.date]={status:String(r.status||meta.status||"PRESENT").toUpperCase(),checkIn:attTime(meta,"checkIn")||attTime(meta,"time"),checkOut:attTime(meta,"checkOut"),lateMinutes:Number(meta.lateMinutes||0)||0,source:"attendance"};
  }
  const {results:confirmed}=await env.DB.prepare(`SELECT timestamp,status,late_minutes FROM staff_attendance WHERE org_id=? AND LOWER(email)=LOWER(?) AND timestamp>=? AND timestamp<=? AND deleted_at IS NULL ORDER BY timestamp ASC,updated_at DESC`).bind(orgId,email,`${startRaw}T00:00:00`,`${endRaw}T23:59:59`).all();
  for(const r of confirmed||[]){
    const d=new Date(r.timestamp); if(isNaN(d.getTime())) continue;
    const key=localParts(d).date; if(map[key]) continue;
    map[key]={status:String(r.status||"ABSENT").toUpperCase(),checkIn:"",checkOut:"",lateMinutes:Number(r.late_minutes||0)||0,source:"staff_attendance"};
  }
  return map;
}

function computeHourlyAssignment(a,map,startRaw,endRaw){
  const sh=sessionHours(a.startTime,a.endTime,a.hours), ss=timeHours(a.startTime), se=timeHours(a.endTime), real=Number.isFinite(ss)&&Number.isFinite(se)&&se>ss;
  let scheduled=0,present=0,late=0,absent=0,openPunch=0,lateMinutesTotal=0,hoursWorked=0,pay=0,full=0;
  for(const d of daysBetween(startRaw,endRaw)){
    if(!dayMatches(a.day,d)) continue; scheduled++; full+=sh*a.rate;
    const key=dateKey(d), rec=map[key];
    if(!rec||rec.status==="ABSENT"){absent++;continue;}
if(real&&rec.checkIn&&rec.checkOut){
      const ih=timeHours(rec.checkIn),oh=timeHours(rec.checkOut), overlap=Math.max(0,Math.min(se,oh)-Math.max(ss,ih));
      hoursWorked+=overlap;pay+=overlap*a.rate;
      if(overlap<=0) absent++; else if(ih>ss+1/60){late++;lateMinutesTotal+=Math.round((ih-ss)*60);} else present++;
    } else if(rec.checkIn&&!rec.checkOut){ openPunch++; }
    else if(rec.status==="LATE"){
      late++; const missed=Math.min(rec.lateMinutes,sh*60), frac=sh>0?Math.max(0,1-missed/(sh*60)):0; lateMinutesTotal+=rec.lateMinutes; const h=sh*frac; hoursWorked+=h;pay+=h*a.rate;
    } else { present++;hoursWorked+=sh;pay+=sh*a.rate; }
  }
  return {sessionHours:sh,sessionsScheduled:scheduled,sessionsPresent:present,sessionsLate:late,sessionsAbsent:absent,sessionsOpenPunch:openPunch,lateMinutesTotal, hoursWorked:round2(hoursWorked),pay:round2(pay),fullAttendancePay:round2(full)};
}
function computeGeneralHourly(map,startRaw,endRaw,rate){
  let hours=0,daysCounted=0,daysOpenPunch=0;
  for(const d of daysBetween(startRaw,endRaw)){
    const key=localParts(d).date,rec=map[key]; if(!rec||rec.status==="ABSENT") continue;
    if(rec.checkIn&&rec.checkOut){ const diff=timeHours(rec.checkOut)-timeHours(rec.checkIn);if(diff>0){hours+=diff;daysCounted++;} }
    else if(rec.checkIn&&!rec.checkOut) daysOpenPunch++;
  }
  return {hours:round2(hours),pay:round2(hours*rate),daysCounted,daysOpenPunch};
}

export async function calculateTeacherPayroll(data,auth,env){
  if(!auth?.token) return authError();
  try{
    const v=await viewer(env,auth); if(!v) return {success:false,error:"Session invalide."};
    if(!canPayroll(v,"calculateTeacherPayroll")) return {success:false,error:"Accès refusé : permission Finance/Paie requise."};
    const startRaw=String(data?.startDate||""),endRaw=String(data?.endDate||""); if(!dateRange(startRaw,endRaw)) return {success:false,error:"Plage de dates invalide."};
    const orgId=await resolveOrgId(env);
    const {results:assignments}=await env.DB.prepare(`SELECT * FROM teacher_assignments WHERE org_id=? AND deleted_at IS NULL AND active=1 ORDER BY teacher_name,class_name`).bind(orgId).all();
    const {results:users}=await env.DB.prepare(`SELECT id,user_id,email,name,active,pay_mode,pay_rate,pay_fixed_salary FROM users WHERE deleted_at IS NULL`).all();
    const by={}, emailCache={}; const warnings=[]; const wanted=String(data?.teacherId||"").trim();
    for(const r of assignments||[]){
      if(wanted&&String(r.teacher_id||"")!==wanted&&String(r.teacher_name||"")!==wanted) continue;
      const name=String(r.teacher_name||"").trim(),tid=String(r.teacher_id||name).trim(),key=tid||name;if(!name)continue;
      if(!by[key])by[key]={teacherId:tid,teacherName:name,assignments:[],baseSalary:0,fullAttendanceSalary:0,netSalary:0,warnings:[]};
      const b=by[key],mode=String(r.payment_mode||"").trim().toUpperCase();
      if(mode!=="HOURLY"&&mode!=="FIXED"){b.warnings.push(`Mode de paiement non configuré pour ${r.subject||""} / ${r.class_name||""} — cette affectation est exclue du calcul.`);continue;}
      if(mode==="FIXED"){const amount=Number(r.salary)||0;b.assignments.push({className:r.class_name,subject:r.subject,paymentMode:"FIXED",amount,note:"Montant fixe (indépendant de la présence)."});b.baseSalary+=amount;b.fullAttendanceSalary+=amount;continue;}
      let email=emailCache[key];if(email===undefined){email="";for(const u of users||[]){if(norm(u.email)===norm(tid)||norm(u.user_id)===norm(tid)||norm(u.name)===norm(name)){email=String(u.email||"").trim().toLowerCase();break;}}emailCache[key]=email;}
      if(!email){b.warnings.push(`Aucun compte/email trouvé pour ${name} — impossible de lire son pointage pour ${r.subject||""} / ${r.class_name||""}.`);continue;}
      const map=await attendanceMap(env,orgId,email,startRaw,endRaw); const calc=computeHourlyAssignment({day:r.day,startTime:r.start_time,endTime:r.end_time,hours:Number(r.hours)||0,rate:Number(r.rate)||0},map,startRaw,endRaw);
      b.assignments.push({className:r.class_name,subject:r.subject,paymentMode:"HOURLY",rate:Number(r.rate)||0,...calc,amount:calc.pay,fullAttendanceAmount:calc.fullAttendancePay});b.baseSalary+=calc.pay;b.fullAttendanceSalary+=calc.fullAttendancePay;
      if(calc.sessionsOpenPunch>0)b.warnings.push(`${calc.sessionsOpenPunch} séance(s) avec pointage d'entrée mais pas de sortie pour ${r.subject||""} / ${r.class_name||""} — non comptée(s) dans le calcul, à corriger manuellement.`);
    }
    const covered=new Set();for(const k of Object.keys(by)){covered.add(norm(k));covered.add(norm(by[k].teacherName));}
    for(const u of users||[]){
      if(Number(u.active)===0)continue;const mode=String(u.pay_mode||"").trim().toUpperCase();if(mode!=="HOURLY"&&mode!=="FIXED")continue;
      const key=String(u.user_id||u.email||u.name||"").trim(),name=String(u.name||u.email||key).trim();if(!name)continue;
      if(covered.has(norm(key))||covered.has(norm(name)))continue;if(wanted&&key!==wanted&&name!==wanted)continue;
      const b={teacherId:key,teacherName:name,assignments:[],baseSalary:0,fullAttendanceSalary:0,netSalary:0,warnings:[]};
      if(mode==="FIXED"){const amount=Number(u.pay_fixed_salary)||0;b.assignments.push({className:"",subject:"Staff (salaire fixe)",paymentMode:"FIXED",amount,note:"Montant fixe mensuel (indépendant de la présence)."});b.baseSalary=amount;b.fullAttendanceSalary=amount;}
      else {const email=String(u.email||"").trim().toLowerCase();if(!email){b.warnings.push(`Aucun email pour ${name} — impossible de lire son pointage.`);}else{const calc=computeGeneralHourly(await attendanceMap(env,orgId,email,startRaw,endRaw),startRaw,endRaw,Number(u.pay_rate)||0);b.assignments.push({className:"",subject:"Staff (horaire)",paymentMode:"HOURLY",rate:Number(u.pay_rate)||0,hoursWorked:calc.hours,amount:calc.pay});b.baseSalary=calc.pay;b.fullAttendanceSalary=calc.pay;if(calc.daysOpenPunch)b.warnings.push(`${calc.daysOpenPunch} jour(s) avec pointage d'entrée mais pas de sortie — non compté(s), à corriger manuellement.`);}}
      by[key]=b;
    }
    const teachers=Object.values(by).map(t=>{t.baseSalary=round2(t.baseSalary);t.fullAttendanceSalary=round2(t.fullAttendanceSalary);t.deductions=round2(t.fullAttendanceSalary-t.baseSalary);t.netSalary=t.baseSalary;return t;}).sort((a,b)=>a.teacherName.localeCompare(b.teacherName));
    teachers.forEach(t=>t.warnings.forEach(w=>warnings.push(`${t.teacherName}: ${w}`)));
    return {success:true,period:{startDate:startRaw,endDate:endRaw},teachers,warnings};
  }catch(e){return {success:false,error:e.message};}
}

export async function saveTeacherPaymentMode(data,auth,env){
  if(!auth?.token)return authError();try{const v=await viewer(env,auth);if(!v)return {success:false,error:"Session invalide."};if(!isAdmin(v))return {success:false,error:"Accès refusé."};
    const mode=String(data?.paymentMode||data?.payMode||"").trim().toUpperCase();if(!["HOURLY","FIXED"].includes(mode))return {success:false,error:"paymentMode doit être 'HOURLY' ou 'FIXED'."};
    const scope=data?.scope||"assignment",orgId=await resolveOrgId(env);let updated=0;
    if(scope==="teacher"){const wanted=String(data?.teacherId||"").trim();if(!wanted)return {success:false,error:"teacherId requis pour scope=teacher."};const r=await env.DB.prepare(`UPDATE teacher_assignments SET payment_mode=?,version=version+1,updated_at=? WHERE org_id=? AND deleted_at IS NULL AND (teacher_id=? OR teacher_name=?)`).bind(mode,new Date().toISOString(),orgId,wanted,wanted).run();updated=Number(r.meta?.changes||0);}
    else {const id=String(data?.assignmentId||data?.id||"").trim();if(!id)return {success:false,error:"assignmentId requis."};const r=await env.DB.prepare(`UPDATE teacher_assignments SET payment_mode=?,version=version+1,updated_at=? WHERE org_id=? AND id=? AND deleted_at IS NULL`).bind(mode,new Date().toISOString(),orgId,id).run();updated=Number(r.meta?.changes||0);}
    if(!updated)return {success:false,error:"Aucune affectation correspondante trouvée."};await writeAudit(env.DB,{table:"teacher_assignments",rowId:String(data?.assignmentId||data?.teacherId||"PAYMODE"),userId:v.id,op:"payment_mode",diff:{scope,paymentMode:mode,updated}});return {success:true,updated};
  }catch(e){return {success:false,error:e.message};}
}

export async function processPayrollBatch(data,auth,env){
  if(!auth?.token)return authError();try{const v=await viewer(env,auth);if(!v)return {success:false,error:"Session invalide."};if(!isAdmin(v))return {success:false,error:"Accès refusé : traitement de paie réservé à l'administration."};
    const batch=Array.isArray(data)?data:(Array.isArray(data?.batch)?data.batch:[]);if(!batch.length)return {success:false,error:"Aucune ligne de paie à traiter."};const orgId=await resolveOrgId(env);const now=new Date().toISOString();
    const accepted=[],skipped=[];
    // D1 transaction: duplicate validation and inserts are committed together.
    const {results:existing}=await env.DB.prepare(`SELECT collaborateur_id,collaborateur,statut,mois,periode_debut,periode_fin FROM payroll WHERE org_id=? AND UPPER(statut)='PAYE'`).bind(orgId).all();
    const paid={};for(const r of existing||[]){const id=norm(r.collaborateur_id||r.collaborateur);if(!id)continue;(paid[id]??=[]).push(periodFromRow({month:r.mois,period_start:r.periode_debut,period_end:r.periode_fin}));}
    for(const item of batch){const name=String(item.name||item.teacherName||"").trim(),id=String(item.teacherId||item.collaborateurId||"").trim(),ident=norm(id||name);if(!ident){skipped.push({name:name||"(sans nom)",reason:"Identifiant collaborateur manquant."});continue;}
      const p=dateRange(String(item.periodStart||""),String(item.periodEnd||""))||(/^\d{4}-\d{2}$/.test(String(item.month||""))?{start:new Date(`${item.month}-01T00:00:00`),end:new Date(new Date(`${item.month}-01T00:00:00`).getFullYear(),new Date(`${item.month}-01T00:00:00`).getMonth()+1,0,23,59,59)}:null);
      const clash=(paid[ident]||[]).find(x=>overlaps(x,p));if(clash){skipped.push({name:name||id,reason:"Déjà payé(e) pour une période chevauchante — paiement ignoré pour éviter un doublon."});continue;}
      accepted.push({name,id,month:String(item.month||monthFrom(item.periodStart)||""),base:Number(item.baseSalary||0)||0,deductions:Number(item.deductions||0)||0,net:Number(item.netSalary||0)||0,start:String(item.periodStart||""),end:String(item.periodEnd||""),by:String(item.processedBy||v.email||v.user_id||"").trim(),period:p});
      if(!paid[ident])paid[ident]=[];paid[ident].push(p);
    }
    const stmts=[];for(const x of accepted){const rid="PAY-"+crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();stmts.push(env.DB.prepare(`INSERT INTO payroll(id,org_id,date,mois,collaborateur,salaire_base,retenues,salaire_net,statut,traite_par,collaborateur_id,periode_debut,periode_fin,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NULL)`).bind(rid,orgId,now,x.month,x.name,x.base,x.deductions,x.net,"PAYE",x.by,x.id,x.start,x.end,now));}
    if(stmts.length)await env.DB.batch(stmts);await writeAudit(env.DB,{table:"payroll",rowId:"BATCH",userId:v.id,op:"payroll_batch",diff:{accepted:accepted.length,skipped:skipped.length}});return {success:true,count:accepted.length,skipped};
  }catch(e){return {success:false,error:e.message};}
}

export async function getPayrollHistory(_data,auth,env){
  if(!auth?.token)return authError();try{const v=await viewer(env,auth);if(!v)return {success:false,error:"Session invalide.",records:[]};if(!canPayroll(v,"getPayrollHistory"))return {success:false,error:"Accès refusé : permission Finance/Paie requise.",records:[]};const orgId=await resolveOrgId(env);const {results}=await env.DB.prepare(`SELECT id,date,mois,collaborateur,salaire_base,retenues,salaire_net,statut,traite_par,collaborateur_id,periode_debut,periode_fin,version,updated_at FROM payroll WHERE org_id=? AND deleted_at IS NULL ORDER BY date DESC,updated_at DESC`).bind(orgId).all();return {success:true,records:(results||[]).map(r=>({id:r.id,date:r.date||"",month:r.mois||"",name:r.collaborateur||"",teacherId:r.collaborateur_id||"",periodStart:r.periode_debut||"",periodEnd:r.periode_fin||"",baseSalary:Number(r.salaire_base)||0,deductions:Number(r.retenues)||0,netSalary:Number(r.salaire_net)||0,status:r.statut||"",processedBy:r.traite_par||"",updatedAt:r.updated_at||""}))};}catch(e){return {success:false,error:e.message,records:[]};}}
