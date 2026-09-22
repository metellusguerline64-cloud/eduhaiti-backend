// promotion.js — Promotion / decision scolaire + classement.
// Port des fonctions Code.gs: getPromotionDecision_, getPromotionOverview_,
// processPromotionDecision_, getStudentClassRank_ and getNextAcademicLevel_.
// The formulas intentionally follow the source: configured curriculum,
// bulletin divisor rules, promotion/remedial thresholds, and competition rank.

import { resolveOrgId } from "../lib/org.js";
import { getSetting } from "../lib/settings.js";
import { loadViewer, assertStudentAccess, filterStudents } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";
import { flattenCurriculumMap } from "./curriculum.js";

const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
const normLabel = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const n = (v, fallback = 0) => { const x = Number(v); return Number.isFinite(x) ? x : fallback; };
const bool = (v, fallback = false) => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["1","true","yes","oui","on","active"].includes(s)) return true;
  if (["0","false","no","non","off","inactive"].includes(s)) return false;
  return fallback;
};

function parseJson(v, fallback = {}) { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "")); } catch { return fallback; } }
function round(v, mode = "ROUND") { const x = n(v); if (String(mode).toUpperCase() === "FLOOR") return Math.floor(x * 100) / 100; if (String(mode).toUpperCase() === "CEIL") return Math.ceil(x * 100) / 100; return Math.round(x * 100) / 100; }

async function settings(env) {
  const { results } = await env.DB.prepare(`SELECT key,value FROM settings`).all();
  const out = {};
  for (const r of results || []) out[String(r.key)] = parseJson(r.value, r.value);
  return out;
}

function gradingPolicy(conf) {
  const raw = conf.GRADING_POLICY;
  const p = raw && typeof raw === "object" ? raw : parseJson(raw, {});
  return {
    promotionThreshold: n(p.promotionThreshold, n(conf.PROMOTION_MIN_AVG, n(conf.MIN_PASSING_AVG, 60))),
    remedialThreshold: n(p.remedialThreshold, n(conf.MIN_ADJOURN_AVG, 40)),
    minSubjectAvg: n(p.minSubjectAvg, n(conf.MIN_SUBJECT_AVG, 50)),
    maxFailures: Math.max(0, Math.floor(n(p.maxFailures, n(conf.MAX_SUBJECT_FAILURES, 0)))),
    allowCompensation: bool(p.allowCompensation, bool(conf.ALLOW_COMPENSATION, true)),
    roundingMode: String(p.roundingMode || conf.ROUNDING_MODE || "ROUND").toUpperCase(),
    missingPeriodPolicy: String(p.missingPeriodPolicy || conf.MISSING_PERIOD_POLICY || "ZERO").toUpperCase(),
  };
}

function activeLevels(conf) { const raw = conf.ACTIVE_LEVELS; const a = Array.isArray(raw) ? raw : parseJson(raw, []); return Array.isArray(a) ? a : []; }
function levelIdFromLabel(level, conf) { const want = norm(level); const hit = activeLevels(conf).find(l => norm(l?.id) === want || norm(l?.label || l?.name) === want); return hit ? String(hit.id || hit.label || "") : null; }
function cycleFor(levelEntry) { return String(levelEntry?.cycle || levelEntry?.cycleKey || levelEntry?.group || "").trim().toLowerCase(); }
function nextAcademicLevel(current, conf) {
  const levels = activeLevels(conf); if (!levels.length || !current) return null;
  const idx = levels.findIndex(l => norm(l?.id) === norm(current) || norm(l?.label || l?.name) === norm(current));
  if (idx < 0 || idx + 1 >= levels.length) return "ALUMNI";
  const cur = levels[idx], candidate = levels[idx + 1];
  const rank = { maternelle: 1, fondamental: 2, primaire: 2, secondaire: 3, university: 4, universitaire: 4, prof_cert: 4, prof_dip: 4 };
  const a = rank[cycleFor(cur)], b = rank[cycleFor(candidate)];
  if (a != null && b != null && b < a) return "ALUMNI";
  return String(candidate?.label || candidate?.id || "").trim();
}

async function activeHistory(env, orgId, studentId = null) {
  const where = studentId ? " AND student_id = ?" : "";
  const params = studentId ? [orgId, studentId] : [orgId];
  const { results } = await env.DB.prepare(`
    SELECT h.* FROM student_history h
    JOIN (SELECT student_id, MAX(updated_at) AS max_updated FROM student_history WHERE org_id = ? ${studentId ? "AND student_id = ?" : ""} GROUP BY student_id) x
      ON x.student_id=h.student_id AND x.max_updated=h.updated_at
    WHERE h.org_id = ? AND h.status='ACTIVE' ${studentId ? "AND h.student_id = ?" : ""}
  `).bind(...(studentId ? [orgId, studentId, orgId, studentId] : [orgId, orgId])).all();
  return results || [];
}

async function curriculum(env) {
  const conf = await settings(env);
  const school = parseJson(conf.SCHOOL_CURRICULUM, {});
  if (school && typeof school === "object" && !Array.isArray(school) && Object.keys(school).length) return { conf, curriculum: school };
  const { results } = await env.DB.prepare(`SELECT key,value FROM settings WHERE key LIKE 'CURRICULUM_%'`).all();
  const raw = {};
  for (const r of results || []) { const key = String(r.key || ""); if (key === "SCHOOL_CURRICULUM") continue; raw[key.slice(11).toLowerCase()] = parseJson(r.value, null); }
  return { conf, curriculum: flattenCurriculumMap(raw) };
}

function subjectList(curr, level, conf) {
  const id = levelIdFromLabel(level, conf);
  const direct = curr[id] || curr[String(id || "").toLowerCase()] || curr[level] || curr[String(level).toLowerCase()];
  if (Array.isArray(direct)) return direct;
  const k = Object.keys(curr || {}).find(x => norm(x) === norm(id || level));
  return k && Array.isArray(curr[k]) ? curr[k] : [];
}

function bulletinDivisor(conf, level, levelId, period, fallback) {
  const rules = parseJson(conf.BULLETIN_DIVISOR_RULES_JSON, {});
  const levels = rules.levels && typeof rules.levels === "object" ? rules.levels : rules;
  const p = String(period || "").toLowerCase();
  const read = node => {
    if (!node || typeof node !== "object") return null;
    const periods = node.periods && typeof node.periods === "object" ? node.periods : {};
    let v;
    const num = p.replace(/[^0-9]/g, "");
    v = periods[num] ?? periods[`P${num}`] ?? node[`P${num}`] ?? node[num];
    const x = n(v, 0); return x > 0 ? x : null;
  };
  const keys = [level, levelId].filter(Boolean);
  for (const key of keys) { if (levels[key]) { const v = read(levels[key]); if (v != null) return v; } const found = Object.keys(levels || {}).find(k => norm(k) === norm(key)); if (found) { const v = read(levels[found]); if (v != null) return v; } }
  return Math.max(1, n(fallback, 1));
}

async function gradeRows(env, orgId, studentId, historyId) {
  const { results } = await env.DB.prepare(`SELECT subject_id,period_id,score,mention,scores_json FROM grades WHERE org_id=? AND student_id=? AND deleted_at IS NULL AND (history_id=? OR history_id IS NULL)`).bind(orgId, studentId, historyId || "").all();
  const map = {}, mentionMap = {};
  for (const r of results || []) {
    const sj = parseJson(r.scores_json, {});
    const entries = Object.keys(sj).length ? Object.entries(sj) : [[String(r.period_id || "T1"), r.score ?? r.mention]];
    for (const [period, raw] of entries) {
      if (!/^T[1-6]$/.test(period) || raw === "" || raw == null) continue;
      const score = Number(raw);
      const key = `${normLabel(r.subject_id)}|${period}`;
      if (Number.isFinite(score)) { if (!map[key]) map[key] = []; map[key].push(score); }
      else if (String(raw).trim()) { if (!mentionMap[key]) mentionMap[key] = String(raw).trim(); }
    }
  }
  return { map, mentionMap };
}

function decide(yearlyAvg, failures, missingPeriods, policy) {
  const allowed = policy.allowCompensation ? policy.maxFailures : 0;
  let decision = yearlyAvg >= policy.promotionThreshold && failures <= allowed ? "PROMOTED" : "REPEATED";
  let comment = decision === "PROMOTED" ? (failures ? "Promotion validee avec compensation autorisee par la politique." : "Promotion validee selon les seuils configures.") : "Moyenne insuffisante pour validation.";
  if (yearlyAvg >= policy.remedialThreshold && decision !== "PROMOTED") { decision = "ADJOURNED"; comment = "Resultat en zone de rattrapage. Decision ajournee recommandee."; }
  if (missingPeriods > 0 && policy.missingPeriodPolicy === "REPEAT") { decision = "REPEATED"; comment = "Periodes manquantes detectees: repetition imposee par la politique."; }
  else if (missingPeriods > 0 && policy.missingPeriodPolicy === "ADJOURN" && decision === "PROMOTED") { decision = "ADJOURNED"; comment = "Periodes manquantes detectees: decision ajournee par prudence."; }
  let risk = Math.max(0, Math.min(100, Math.round(100 - yearlyAvg))); if (failures) risk = Math.min(100, risk + failures * 8); if (missingPeriods) risk = Math.min(100, risk + missingPeriods * 6);
  return { decision, comment, risk };
}

export async function getPromotionDecision(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const orgId = await resolveOrgId(env); const sid = String(data?.studentId || (typeof data === "string" ? data : "")).trim();
  if (!sid) return { success:false, error:"Matricule manquant." };
  const guard = await assertStudentAccess(env, auth, orgId, sid); if (!guard.allowed) return { success:false, error:guard.error };
  const { conf, curriculum: curr } = await curriculum(env); const hist = (await activeHistory(env, orgId, sid))[0];
  if (!hist) return { success:true, decision:"NO_DATA", yearlyAvg:"0.00", riskScore:50, aiComment:"Classe introuvable pour " + sid, subjectAnalysis:[], summary:[], stabilityIndex:0 };
  const subjects = subjectList(curr, hist.grade_level_id, conf); if (!subjects.length) return { success:true, decision:"NO_DATA", yearlyAvg:"0.00", riskScore:50, aiComment:"Programme non defini pour " + hist.grade_level_id, subjectAnalysis:[], summary:[], stabilityIndex:0, debugAvailableCurriculumKeys:Object.keys(curr||{}) };
  const totalTerms = Math.max(1, parseInt(n(conf.TOTAL_TERMS, 4),10) || 4), policy = gradingPolicy(conf), levelId = levelIdFromLabel(hist.grade_level_id, conf), grades = await gradeRows(env, orgId, sid, hist.history_id);
  const unique = new Map(); for (const s of subjects) { const k=normLabel(s?.label||s?.id||s?.subjectId); if(k&&!unique.has(k)) unique.set(k,s); }
  const details=[], periodRaw=Array(totalTerms).fill(0), periodCount=Array(totalTerms).fill(0); let failures=0, missingPeriods=0;
  for (const [key,s] of unique) {
    const values=[]; const timeline=[]; for(let p=0;p<totalTerms;p++){const arr=grades.map[`${key}|T${p+1}`]||[]; const raw=arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null; if(raw==null) missingPeriods++; else {values.push(raw); periodRaw[p]+=raw; periodCount[p]++;} timeline.push(raw==null?(policy.missingPeriodPolicy==="ZERO"?0:""):round(raw,policy.roundingMode));}
    const avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:0; const pts=n(s?.coeff ?? s?.coef ?? s?.points,100); const min=n(s?.minRequiredScore ?? s?.minScore ?? s?.requiredMin,policy.minSubjectAvg); const graded=values.length>0; const failed=graded&&avg<min; if(failed) failures++; details.push({subject:s?.label||s?.id||s?.subjectId,average:round(avg,policy.roundingMode),points:round(avg*(pts/100),2),max:pts,timeline,isCritical:bool(s?.isCritical??s?.isMajor),minRequiredScore:min,graded,failed,mentions:Object.fromEntries(Array.from({length:totalTerms},(_,i)=>[`T${i+1}`,grades.mentionMap[`${key}|T${i+1}`]||""]))}); }
  const periodAverages=[]; for(let p=0;p<totalTerms;p++){const avg=periodRaw[p]/bulletinDivisor(conf,hist.grade_level_id,levelId,`T${p+1}`,periodCount[p]||1); periodAverages.push(round(avg,policy.roundingMode));}
  const yearly=round(periodAverages.reduce((a,b)=>a+b,0)/totalTerms,policy.roundingMode); const deltas=[]; const gradedPeriods=[]; for(let p=0;p<totalTerms;p++)if(periodCount[p]>0)gradedPeriods.push({period:`P${p+1}`,average:periodAverages[p]}); for(let i=1;i<gradedPeriods.length;i++)deltas.push(round(gradedPeriods[i].average-gradedPeriods[i-1].average,2)); const net=deltas.length?round(gradedPeriods.at(-1).average-gradedPeriods[0].average,2):0; const trend=net<=-5?"declining":net>=5?"improving":"stable";
  const isMat=String(levelId||hist.grade_level_id).toLowerCase().includes("mat") || String(hist.grade_level_id).toLowerCase().includes("section des"); const pack=isMat?{decision:"PROMOTED",comment:"Cycle maternelle : avancement automatique par âge/cycle, pas de redoublement sur base académique. Notes affichées à titre indicatif (mentions).",risk:0}:decide(yearly,failures,missingPeriods,policy); if(trend==="declining"&&!isMat){pack.risk=Math.min(100,pack.risk+Math.min(25,Math.round(Math.abs(net))));pack.comment += ` Tendance à la baisse détectée entre périodes (${net.toFixed(1)} pts) — surveillance recommandée.`;}
  return {success:true,decision:pack.decision,yearlyAvg:yearly.toFixed(2),riskScore:pack.risk,aiComment:pack.comment,subjectAnalysis:details,summary:periodAverages.map((average,i)=>({period:`P${i+1}`,average:average.toFixed(2)})),periodAverages:Object.fromEntries(periodAverages.map((v,i)=>[`P${i+1}`,v.toFixed(2)])),periodTrend:{direction:trend,gradedPeriods,deltas,netDelta:net,atRisk:trend==="declining"},stabilityIndex:periodAverages.length>1?Math.max(0,Math.min(100,Math.round(100-Math.sqrt(periodAverages.reduce((a,b)=>a+Math.pow(b-(periodAverages.reduce((x,y)=>x+y,0)/periodAverages.length),2),0)/periodAverages.length)*2.5))):100,failures,isMaternelleCycle:isMat,policySnapshot:policy,gradedPeriodsCount:gradedPeriods.length,totalTerms,dataComplete:gradedPeriods.length>=totalTerms,ungradedSubjectsCount:details.filter(x=>!x.graded).length,meta:{historicClass:hist.grade_level_id,currentLevel:hist.grade_level_id,missingPeriods,totalTerms}};
}

export async function getPromotionOverview(data, auth, env) {
  if (!auth?.token) return { success:false,error:"Non authentifié." }; const orgId=await resolveOrgId(env); const viewer=await loadViewer(env,auth); if(!viewer)return {success:false,error:"Session invalide."};
  const rows=[]; const hist=await activeHistory(env,orgId); const {conf}=await curriculum(env); const students=(await env.DB.prepare(`SELECT student_code,first_name,last_name FROM students WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all()).results||[]; const names={}; for(const s of students)names[String(s.student_code).toUpperCase()]=[s.first_name,s.last_name].filter(Boolean).join(" ")||s.student_code;
  for(const h of hist){const dec=await getPromotionDecision({studentId:h.student_id,targetYear:data?.targetYear},auth,env); const eligible=dec.decision==="PROMOTED"?true:(dec.decision==="REPEATED"||dec.decision==="NO_DATA"?false:undefined); const next=nextAcademicLevel(h.grade_level_id,conf)||h.grade_level_id; rows.push({studentId:h.student_id,id:h.student_id,studentName:names[String(h.student_id).toUpperCase()]||h.student_id,currentClass:h.grade_level_id,currentLevel:h.grade_level_id,nextClass:next,average:dec.success?Number(dec.yearlyAvg):null,eligible,decision:dec.decision||"NO_DATA",gradedPeriodsCount:Number(dec.gradedPeriodsCount||0),totalTerms:Number(dec.totalTerms||0),dataComplete:!!dec.dataComplete,trendDirection:dec.periodTrend?.direction||"stable",atRisk:!!dec.periodTrend?.atRisk,riskScore:dec.riskScore==null?null:Number(dec.riskScore),isMaternelleCycle:!!dec.isMaternelleCycle});}
  return {success:true,rows:viewer.isMaster||viewer.isGodMode?rows:filterStudents(viewer,rows.map(r=>({...r,StudentCode:r.studentId,CurrentLevel:r.currentLevel,Section:r.section||""})))};
}

export async function processPromotionDecision(data, auth, env) {
  if (!auth?.token) return {success:false,error:"Non authentifié."}; const orgId=await resolveOrgId(env); const sid=String(data?.studentId||"").trim(); if(!sid)return {success:false,error:"Matricule manquant."}; const viewer=await loadViewer(env,auth); if(!viewer)return {success:false,error:"Session invalide."}; const allowed=viewer.isMaster||viewer.isGodMode||viewer.permissions?.pa_promote_student; if(!allowed)return {success:false,error:"Droits insuffisants."};
  let decision=String(data?.decision||"").trim().toUpperCase(); if(!["PROMOTED","REPEATED","ADJOURNED"].includes(decision)){const d=await getPromotionDecision({studentId:sid},auth,env); if(!d.success)return d; decision=d.decision;} const hist=(await activeHistory(env,orgId,sid))[0]; if(!hist)return {success:false,error:`Historique introuvable pour ${sid}`}; const {conf}=await curriculum(env); const nextYear=String(conf.ACADEMIC_YEAR||"").trim(); const now=new Date().toISOString(); const closure={...hist,history_id:`HIS-${crypto.randomUUID().replace(/-/g,"").slice(0,8)}`,status:decision,updated_at:now}; const stmts=[env.DB.prepare(`INSERT INTO student_history(id,history_id,student_id,org_id,school_year,grade_level_id,section,status,drop_reason,drop_date,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),closure.history_id,closure.student_id,orgId,closure.school_year,closure.grade_level_id,closure.section||"A",decision,null,null,now)]; if(decision==="PROMOTED"||decision==="REPEATED"){const level=decision==="PROMOTED"?(nextAcademicLevel(hist.grade_level_id,conf)||"ALUMNI"):hist.grade_level_id; stmts.push(env.DB.prepare(`INSERT INTO student_history(id,history_id,student_id,org_id,school_year,grade_level_id,section,status,drop_reason,drop_date,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),`HIS-${crypto.randomUUID().replace(/-/g,"").slice(0,8)}`,sid,orgId,nextYear,level,hist.section||"A","ACTIVE",null,null,now));}
  await env.DB.batch(stmts); await writeAudit(env.DB,{table:"student_history",rowId:sid,userId:viewer.id||viewer.email,op:"PROMOTION",diff:{decision}}); return {success:true,status:decision,studentId:sid};
}

export async function getStudentClassRank(data, auth, env) {
  if(!auth?.token)return{success:false,error:"Non authentifié."}; const orgId=await resolveOrgId(env); const sid=String(data?.studentId||data?.id||(typeof data==="string"?data:"")).trim(); if(!sid)return{success:false,error:"Identifiant élève manquant."}; const guard=await assertStudentAccess(env,auth,orgId,sid);if(!guard.allowed)return{success:false,error:guard.error}; const hist=(await activeHistory(env,orgId,sid))[0];if(!hist)return{success:true,mentionOnly:true,rank:null,average:null,classSize:0}; const all=await activeHistory(env,orgId); const same=all.filter(h=>normLabel(h.grade_level_id)===normLabel(hist.grade_level_id)&&String(h.section||"")===String(hist.section||"")); const rows=[]; let mentionOnly=false; for(const h of same){const g=await gradeRows(env,orgId,h.student_id,h.history_id); const bySub={}; let hasMention=false; for(const [key,vals] of Object.entries(g.map)){const [sub,period]=key.split("|");if(!bySub[sub])bySub[sub]=[];bySub[sub].push(...vals);} for(const key of Object.keys(g.mentionMap))if(g.mentionMap[key])hasMention=true; if(hasMention)mentionOnly=true; const av=Object.values(bySub).map(v=>v.reduce((a,b)=>a+b,0)/v.length); rows.push({sid:h.student_id,avg:av.length?Number((av.reduce((a,b)=>a+b,0)/av.length).toFixed(2)):0});} if(mentionOnly)return{success:true,mentionOnly:true,rank:null,average:null,classSize:same.length}; rows.sort((a,b)=>b.avg-a.avg); let rank=0,last=null;const ranks={};rows.forEach((r,i)=>{if(last===null||r.avg!==last){rank=i+1;last=r.avg;}ranks[r.sid]={rank,average:r.avg};});const me=ranks[sid];return{success:true,mentionOnly:false,rank:me?.rank??null,average:me?.average??null,classSize:rows.length};}
