export { getSubjectsByLevel } from "./curriculum.js";
// reports.js — Reports / Analytics port from Code.gs.
// Ported actions:
//   getImmersiveData
//   getComplexReportData
//   getUniversalAnalytics
//   getClassComparisonData
//   logReportGenerated
//   getSubjectsByLevel
// The response shapes intentionally follow the original frontend contract.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { assertStudentAccess, loadViewer, canAccessStudent, filterStudents } from "../lib/accessScope.js";
import { getSetting } from "../lib/settings.js";
import { getPromotionDecision } from "./promotion.js";
import { resolveExpectedTuition } from "./payments.js";

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || ""); } catch { return fallback; }
}
function norm(v) { return String(v ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function studentIdOf(s) { return String(s?.student_code ?? s?.StudentCode ?? s?.student_id ?? s?.StudentID ?? s?.id ?? "").trim(); }
function levelOf(s) { return String(s?.current_level ?? s?.CurrentLevel ?? s?.grade_level_id ?? s?.GradeLevelID ?? s?.level ?? "").trim(); }
function nameOf(s) { return `${String(s?.first_name ?? s?.FirstName ?? "").trim()} ${String(s?.last_name ?? s?.LastName ?? "").trim()}`.trim().toUpperCase(); }

function cycleOf(v) {
  const x = norm(v);
  if (!x) return "";
  if (x.includes("MAT")) return "MATERNELLE";
  if (x.includes("FOND") || x.includes("PRIMA") || x === "AF") return "FONDAMENTAL";
  if (/^NS[1-4]$/.test(x) || x.includes("SECOND") || x.includes("RHETO") || x.includes("PHILO") || x.includes("TERM") || x.includes("LYCEE") || x.includes("COLLEGE")) return "SECONDAIRE";
  return "";
}

async function loadStudents(env, orgId, auth) {
  const { results } = await env.DB.prepare(`
    SELECT id,student_code,last_name,first_name,phone,gender,birth_date,address,photo_url,current_level,section,enrollment_status,active,custom_fields
    FROM students WHERE org_id=? AND deleted_at IS NULL ORDER BY last_name,first_name,student_code
  `).bind(orgId).all();
  const viewer = await loadViewer(env, auth);
  return { rows: filterStudents(viewer, results || []), viewer };
}

async function configObject(db) {
  const { results } = await db.prepare(`SELECT key,value FROM settings`).all();
  const out = {};
  for (const r of results || []) out[r.key] = parseJson(r.value, r.value);
  return out;
}

function maxScoreForSubject(conf, subjectId) {
  const global = Number(conf.MAX_SCORE || conf.maxScore || 100);
  const wanted = norm(subjectId);
  let found = 0;
  for (const key of Object.keys(conf || {})) {
    if (!/^CURRICULUM_/i.test(key)) continue;
    let arr = conf[key];
    if (typeof arr === "string") arr = parseJson(arr, null);
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s) continue;
      const sid = norm(s.subjectId || s.id);
      if (sid === wanted) found = Number(s.max || s.maxScore || s.points || 0) || found;
      for (const b of (Array.isArray(s.branches) ? s.branches : [])) {
        if (norm(b?.id || b?.label || b?.name || b?.subject) === wanted) found = Number(b.max || b.maxScore || b.points || 0) || found;
      }
    }
  }
  return found > 0 ? found : (global > 0 ? global : 100);
}

async function gradeStatsForStudent(env, orgId, studentId, conf) {
  const { results } = await env.DB.prepare(`
    SELECT subject_id,score,scores_json FROM grades
    WHERE org_id=? AND student_id=? AND deleted_at IS NULL
  `).bind(orgId, studentId).all();
  const values = [];
  const subjectMap = {};
  for (const r of results || []) {
    const sj = parseJson(r.scores_json, {});
    const entries = Object.keys(sj).length ? Object.entries(sj) : [[r.period_id || "", r.score]];
    for (const [, raw] of entries) {
      const n = Number(raw); if (!Number.isFinite(n)) continue;
      const max = maxScoreForSubject(conf, r.subject_id);
      const pct = Math.max(0, Math.min(100, n / max * 100));
      values.push(pct);
      const key = String(r.subject_id || "").trim();
      if (!subjectMap[key]) subjectMap[key] = { subject: key, sum: 0, count: 0, rawSum: 0, max };
      subjectMap[key].sum += pct; subjectMap[key].rawSum += n; subjectMap[key].count++;
    }
  }
  const avg = values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
  const subjectAnalysis = Object.values(subjectMap).map(s => ({ subject:s.subject, average:Math.round((s.sum/s.count)*10)/10, rawAverage:Math.round((s.rawSum/s.count)*10)/10, max:s.max, count:s.count }));
  return { avg, values, subjectAnalysis, count: values.length };
}

async function attendanceStatsForStudent(env, orgId, studentId) {
  const { results } = await env.DB.prepare(`
    SELECT status,COUNT(*) count FROM attendance
    WHERE org_id=? AND student_id=? AND deleted_at IS NULL GROUP BY status
  `).bind(orgId, studentId).all();
  const counts = {};
  for (const r of results || []) counts[String(r.status || "").toUpperCase()] = Number(r.count) || 0;
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  const present = Object.entries(counts).filter(([k])=>["PRESENT","P","PRES","ON_TIME","LATE","RETARD","TARDY","R"].includes(k)).reduce((a,[,v])=>a+v,0);
  const absent = Object.entries(counts).filter(([k])=>["ABSENT","A"].includes(k)).reduce((a,[,v])=>a+v,0);
  return { success:true, stats:{ total, present, absent, presence:total ? Math.round(present*1000/total)/10 : 0, counts } };
}


export async function getDashboardLiveStats(_data, auth, env) {
  if(!auth?.token)return {success:false,error:'Non authentifié.'};
  try {
    const orgId=await resolveOrgId(env);
    const [students, attendance, histories]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) n FROM students WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).first(),
      env.DB.prepare(`SELECT status FROM attendance WHERE org_id=? AND deleted_at IS NULL AND date=?`).bind(orgId,new Date().toISOString().slice(0,10)).all(),
      env.DB.prepare(`SELECT COUNT(DISTINCT student_id) n FROM student_history WHERE org_id=? AND status='ACTIVE'`).bind(orgId).first(),
    ]);
    const confRows=await env.DB.prepare(`SELECT key,value FROM settings`).all(); const conf={}; for(const r of confRows.results||[]){try{conf[r.key]=JSON.parse(r.value)}catch{conf[r.key]=r.value}}
    const activeStudents=(await env.DB.prepare(`SELECT student_code,current_level FROM students WHERE org_id=? AND deleted_at IS NULL AND active=1`).bind(orgId).all()).results||[];
    let classCount=0; const levels=conf.ACTIVE_LEVELS; if(Array.isArray(levels))classCount=levels.filter(Boolean).length;
    if(!classCount) classCount=new Set(activeStudents.map(s=>String(s.current_level||'').trim()).filter(Boolean)).size;
    const presentToday=(attendance.results||[]).length;

    // Match Code.gs dashboard finance semantics: expected tuition is resolved per
    // active student, while payments exclude void/cancelled/refunded rows.
    const paymentRows=(await env.DB.prepare(`SELECT student_id,amount,status FROM payments WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all()).results||[];
    const paidByStudent={};
    for(const r of paymentRows){
      const st=norm(r.status); if(['VOID','CANCELLED','ANNULE','REFUNDED'].includes(st)) continue;
      const sid=String(r.student_id||'').trim(); if(!sid) continue;
      paidByStudent[sid]=(paidByStudent[sid]||0)+(Number(r.amount)||0);
    }
    const totalPayments=Object.values(paidByStudent).reduce((a,b)=>a+b,0);
    let pendingPayments=0, totalOutstanding=0, configuredCount=0;
    for(const st of activeStudents){
      const sid=String(st.student_code||'').trim(); if(!sid) continue;
      const tuition=await resolveExpectedTuition(env,orgId,sid,conf);
      const expected=Number(tuition?.amount||0); const paid=Number(paidByStudent[sid]||0);
      if(expected>0) configuredCount++;
      const due=Math.max(expected,paid); const outstanding=Math.max(0,due-paid);
      if(outstanding>0.001) pendingPayments++;
      totalOutstanding+=outstanding;
    }
    const financeConfigured=activeStudents.length===0 || configuredCount>0;
    const data={totalStudents:Number(histories?.n||0)||Number(students?.n||0),classCount,totalPayments:totalPayments.toFixed(2),collecte:Number(totalPayments.toFixed(2)),presentToday,pendingPayments,unpaidCount:pendingPayments,outstanding:Number(totalOutstanding.toFixed(2)),financeConfigOk:financeConfigured,financeConfigWarning:financeConfigured?'':'Frais scolaires non configurés pour les élèves actifs. Vérifiez la configuration Finance.'};
    return {success:true,data};
  }catch(e){return {success:false,error:e.message};}
}

export async function getImmersiveData(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const orgId = await resolveOrgId(env);
  const sid = String(data?.id || data?.studentId || data?.studentCode || "").trim();
  if (!sid) return { success:false, error:"studentId requis." };
  const guard = await assertStudentAccess(env, auth, orgId, sid);
  if (!guard.allowed) return { success:false, error:guard.error };
  const s = guard.student;
  const conf = await configObject(env.DB);
  const grades = await gradeStatsForStudent(env, orgId, sid, conf);
  const att = await attendanceStatsForStudent(env, orgId, sid);
  // Use the same promotion engine as the dedicated Promotion domain so the
  // immersive report respects configured divisors, critical subjects, missing
  // periods, mentions and maternelle rules instead of a simplified threshold.
  const official=await getPromotionDecision({studentId:sid},auth,env);
  // Some legacy/test records have no student_history row yet. In that case the
  // official engine correctly reports NO_DATA; retain the original report
  // fallback so existing records with grades still render useful analytics.
  const hasOfficialData=official.success && official.decision!=="NO_DATA";
  const fallbackThreshold=Number(conf.PROMOTION_SCORE || conf.PROMOTION_THRESHOLD || 60);
  const fallbackPassing=Number(conf.PASSING_SCORE || 40);
  const fallbackDecision=grades.avg>=fallbackThreshold?"PROMOTED":grades.avg>=fallbackPassing?"ADJOURNED":"REPEATED";
  const decision=hasOfficialData ? official.decision : (grades.count ? fallbackDecision : "NO_DATA");
  const photo = String(s.photo_url || "").trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(nameOf(s))}&background=8b5cf6&color=fff`;
  return {
    success:true, studentId:sid, studentName:nameOf(s), studentPhoto:photo,
    finalYearlyAvg:hasOfficialData ? String(official.yearlyAvg || "0.00") : grades.avg.toFixed(2), decision,
    riskScore: hasOfficialData && official.riskScore != null ? Number(official.riskScore) : Math.max(0, Math.round(100-grades.avg)),
    subjectAnalysis:hasOfficialData ? (official.subjectAnalysis||[]) : grades.subjectAnalysis,
    aiComment:hasOfficialData ? String(official.aiComment||"") : (grades.count ? "" : "Données insuffisantes."),
    timestamp:new Date().toISOString(),
    meta:hasOfficialData ? {...(official.meta||{}),currentLevel:levelOf(s),section:s.section||"",attendance:att.stats} : { currentLevel:levelOf(s), historicClass:levelOf(s), section:s.section || "", attendance:att.stats }
  };
}

export async function getComplexReportData(data, auth, env) {
  try {
    const sid = String(data?.studentId || data?.id || data?.studentCode || "").trim();
    const orgId = await resolveOrgId(env);
    const guard = await assertStudentAccess(env, auth, orgId, sid);
    if (!guard.allowed) return { success:false, error:guard.error };
    const imm = await getImmersiveData({id:sid}, auth, env);
    if (!imm.success) return { success:false, error:"Élève introuvable." };
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const result = { success:true, studentId:sid, studentName:imm.studentName, studentPhoto:imm.studentPhoto, sections };
    if (sections.includes("ACADEMIC")) result.academic = { avg:imm.finalYearlyAvg, decision:imm.decision };
    if (sections.includes("FINANCE")) {
      const row = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total_paid FROM payments WHERE org_id=? AND student_id=? AND status!='VOID' AND deleted_at IS NULL`).bind(orgId,sid).first();
      result.finance = { totalPaid:Number(row?.total_paid || 0) };
    }
    if (sections.includes("ATTENDANCE")) result.attendance = (await attendanceStatsForStudent(env,orgId,sid)).stats;
    return result;
  } catch(e) { return { success:false, error:e.message }; }
}

export async function getUniversalAnalytics(data, auth, env) {
  try {
    const params = data || {};
    if (params.scope === "STUDENT") {
      const orgId = await resolveOrgId(env);
      const guard = await assertStudentAccess(env, auth, orgId, String(params.targetId || "").trim());
      if (!guard.allowed) return { success:false, error:guard.error };
    }
    const result = { success:true, metadata:params, data:{} };
    if (params.scope === "STUDENT") {
      const d = await getImmersiveData({id:params.targetId}, auth, env);
      if (d.success) { result.studentName=d.studentName; result.data.base=d; }
    }
    const metrics = Array.isArray(params.metrics) ? params.metrics : [];
    if (metrics.includes("ACADEMIC") && params.targetId) {
      const conf = await configObject(env.DB); const s = await gradeStatsForStudent(env, await resolveOrgId(env), params.targetId, conf);
      result.data.academic = { count:s.count, avg:s.count ? s.avg.toFixed(2) : "0.00" };
    }
    if (metrics.includes("ATTENDANCE") && params.targetId) result.data.attendance = (await attendanceStatsForStudent(env,await resolveOrgId(env),params.targetId)).stats;
    if (metrics.includes("FINANCE") && params.targetId) {
      const orgId=await resolveOrgId(env); const r=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total_paid FROM payments WHERE org_id=? AND student_id=? AND status!='VOID' AND deleted_at IS NULL`).bind(orgId,params.targetId).first();
      result.data.finance={totalPaid:Number(r?.total_paid||0)};
    }
    return result;
  } catch(e) { return { success:false, error:e.message }; }
}

export async function getClassComparisonData(data, auth, env) {
  try {
    const req=data||{}; const selectedLevel=String(req.level||"").trim(); const orgId=await resolveOrgId(env);
    const {rows,viewer}=await loadStudents(env,orgId,auth);
    const byLevel={}; for(const s of rows){const l=levelOf(s);if(!l)continue;(byLevel[l] ||= []).push(s);}
    const levels=Object.keys(byLevel); const conf=await configObject(env.DB);
    const att={}; for(const l of levels) att[l]={totals:Array(7).fill(0),present:Array(7).fill(0)};
    const seven=new Set(); for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);seven.add(d.toISOString().slice(0,10));}
    const {results:arows}=await env.DB.prepare(`SELECT student_id,date,status FROM attendance WHERE org_id=? AND deleted_at IS NULL AND date>=date('now','-6 day')`).bind(orgId).all();
    const levelById={}; for(const s of rows) levelById[norm(studentIdOf(s))]=levelOf(s);
    for(const r of arows||[]){const l=levelById[norm(r.student_id)];if(!l||!att[l])continue;const idx=[...seven].indexOf(String(r.date||""));if(idx<0)continue;const st=norm(r.status);if(["EXCUSED","EXCUSE","JUSTIFIED","JUSTIFIE","EJ","EXC"].includes(st))continue;att[l].totals[idx]++;if(["PRESENT","P","PRES","ON_TIME","LATE","RETARD","TARDY","R"].includes(st))att[l].present[idx]++;}
    const {results:grows}=await env.DB.prepare(`SELECT student_id,subject_id,score,scores_json FROM grades WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all();
    const gmap={};
    for(const r of grows||[]){const sid=norm(r.student_id);if(!levelById[sid])continue;const vals=Object.entries(parseJson(r.scores_json,{}));if(!vals.length) vals.push([r.period_id,r.score]);for(const [,raw] of vals){const n=Number(raw);if(!Number.isFinite(n))continue;const pct=Math.max(0,Math.min(100,n/maxScoreForSubject(conf,r.subject_id)*100));(gmap[sid] ||= {sum:0,count:0}).sum+=pct;gmap[sid].count++;}}
    const promotion=Number(conf.PROMOTION_SCORE||conf.PROMOTION_THRESHOLD||60); const passing=Number(conf.PASSING_SCORE||40);
    function metrics(levelName,members,levelKey){let sum=0,count=0,promoted=0,adj=0,rep=0;const bands={excellent:0,bien:0,passable:0,alerte:0};for(const s of members){const st=gmap[norm(studentIdOf(s))];if(!st?.count)continue;const avg=st.sum/st.count;sum+=avg;count++;if(avg>=80)bands.excellent++;else if(avg>=promotion)bands.bien++;else if(avg>=passing)bands.passable++;else bands.alerte++;if(avg>=promotion)promoted++;else if(avg>=passing)adj++;else rep++;}const a=att[levelKey||""]||{totals:Array(7).fill(0),present:Array(7).fill(0)};const trend=a.totals.map((t,i)=>t?Math.round(a.present[i]*1000/t)/10:0);const nz=trend.filter(x=>x>0);const presence=nz.length?Math.round(nz.reduce((x,y)=>x+y,0)/nz.length*10)/10:0;return {className:levelName||"N/A",studentCount:members.length,average:count?Math.round(sum/count*10)/10:0,presence,progression:count?Math.round((promoted*100+adj*60+rep*25)/count*10)/10:0,successRate:count?Math.round(promoted*100/count*10)/10:0,attendanceTrend:trend,performanceBands:bands,promotionStages:[{label:"Candidates",value:count},{label:"Éligibles",value:promoted},{label:"Révision",value:adj},{label:"Bloquées",value:rep}]};}
    const metricsByClass=levels.map(l=>metrics(l,byLevel[l],l)); const selected=selectedLevel?levels.filter(l=>norm(l)===norm(selectedLevel)):levels; const refs=selectedLevel?levels.filter(l=>norm(l)!==norm(selectedLevel)):levels;
    return {success:true,data:{selectedClass:selected.length===1?selected[0]:"Toutes les classes",selected:metrics(selected.length===1?selected[0]:"Toutes les classes",selected.flatMap(l=>byLevel[l]),selected.length===1?selected[0]:null),reference:metrics("Référence globale",refs.flatMap(l=>byLevel[l]),null),classes:metricsByClass,areas:[{key:"average",label:"Moyenne"},{key:"presence",label:"Presence"},{key:"progression",label:"Progression"},{key:"successRate",label:"Taux de reussite"}],generatedAt:new Date().toISOString()}};
  } catch(e){return {success:false,error:e.message};}
}

export async function logReportGenerated(data, auth, env) {
  try {
    const title=String(data?.title||"Rapport").slice(0,80); const format=String(data?.format||"html").toUpperCase(); const scope=String(data?.scope||"");
    const generatedBy=String(data?.generatedBy||auth?.name||auth?.email||"Inconnu");
    const actor=auth?.token ? ((await loadViewer(env,auth))?.email || "") : "";
    await writeAudit(env.DB,{table:"report_generation",rowId:title,userId:actor||generatedBy,deviceId:data?.deviceId,op:"REPORT_GENERATED",diff:{reportTitle:title,format,scope,generatedBy,email:actor,role:data?.role||"",at:new Date().toISOString()}});
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}


// ---------------------------------------------------------------------------
// Full student bulletin/report — Worker-native replacement for the Apps Script
// buildFullStudentReportHtml_ / generateFullStudentReport_ pair.
// Cloudflare Workers/D1 does not provide HtmlService.createHtmlOutput().getAs()
// so the migration deliberately returns print-ready HTML. The browser can use
// window.print() / Save as PDF without exposing the report through Drive.
// ---------------------------------------------------------------------------
function reportEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function reportDateFr() {
  try { return new Intl.DateTimeFormat("fr-FR", { dateStyle:"long" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0,10); }
}

function normalizeReportScore(raw, max) {
  const n = Number(raw);
  const m = Number(max) || 100;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n / m * 100)) : null;
}

async function buildPrintableStudentReport(data, auth, env) {
  const sid = String(data?.studentId || data?.id || data?.studentCode || "").trim();
  if (!sid) return { success:false, error:"studentId requis." };
  const orgId = await resolveOrgId(env);
  const guard = await assertStudentAccess(env, auth, orgId, sid);
  if (!guard.allowed) return { success:false, error:guard.error };

  const conf = await configObject(env.DB);
  const student = guard.student;
  const periods = Math.max(1, Math.min(6, Number(conf.NUM_PERIODS || conf.TOTAL_TERMS || 4) || 4));
  const gradeRows = (await env.DB.prepare(`
    SELECT subject_id, period_id, score, scores_json
    FROM grades
    WHERE org_id=? AND student_id=? AND deleted_at IS NULL
    ORDER BY subject_id, period_id
  `).bind(orgId, sid).all()).results || [];

  const subjectMap = new Map();
  for (const r of gradeRows) {
    const subject = String(r.subject_id || "").trim() || "—";
    if (!subjectMap.has(subject)) subjectMap.set(subject, { subject, scores:Array(periods).fill(null), rawScores:Array(periods).fill(null), max:maxScoreForSubject(conf, subject) });
    const item = subjectMap.get(subject);
    const rawJson = parseJson(r.scores_json, null);
    if (rawJson && typeof rawJson === "object" && Object.keys(rawJson).length) {
      for (const [p, value] of Object.entries(rawJson)) {
        let idx = Number(String(p).replace(/[^0-9]/g, ""));
        if (!Number.isFinite(idx)) continue;
        if (idx >= 1 && idx <= periods) idx -= 1;
        if (idx < 0 || idx >= periods) continue;
        const raw = Number(value); const pct = normalizeReportScore(raw, item.max);
        if (pct !== null) { item.rawScores[idx] = raw; item.scores[idx] = pct; }
      }
    } else {
      const match = String(r.period_id || "").match(/([0-9]+)/);
      const idx = match ? Number(match[1]) - 1 : -1;
      if (idx >= 0 && idx < periods) {
        const raw = Number(r.score); const pct = normalizeReportScore(raw, item.max);
        if (pct !== null) { item.rawScores[idx] = raw; item.scores[idx] = pct; }
      }
    }
  }

  const subjects = [...subjectMap.values()].map(x => {
    const graded = x.scores.filter(v => v !== null);
    x.average = graded.length ? graded.reduce((a,b)=>a+b,0)/graded.length : null;
    return x;
  });
  const allScores = subjects.flatMap(s => s.scores.filter(v => v !== null));
  const average = allScores.length ? allScores.reduce((a,b)=>a+b,0)/allScores.length : 0;
  const att = (await attendanceStatsForStudent(env, orgId, sid)).stats;
  const financeRow = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status!='VOID' AND deleted_at IS NULL THEN amount ELSE 0 END),0) total_paid
    FROM payments WHERE org_id=? AND student_id=?
  `).bind(orgId, sid).first();
  const totalPaid = Number(financeRow?.total_paid || 0);
  const promotionThreshold = Number(conf.PROMOTION_SCORE || conf.PROMOTION_THRESHOLD || 60);
  const passing = Number(conf.PASSING_SCORE || 40);
  const decision = average >= promotionThreshold ? "PROMOTED" : average >= passing ? "ADJOURNED" : "REPEATED";
  const photo = String(student.photo_url || "").trim();

  const headers = Array.from({length:periods}, (_,i)=>`T${i+1}`);
  const body = subjects.length ? subjects.map(s => {
    const cells = s.scores.map(v => `<td>${v === null ? "—" : v.toFixed(1)}</td>`).join("");
    return `<tr><td class="subject">${reportEscape(s.subject)}</td>${cells}<td>${s.average === null ? "—" : s.average.toFixed(1)}</td><td>${reportEscape(s.max)}</td></tr>`;
  }).join("") : `<tr><td colspan="${periods+3}" class="empty">Aucune note disponible.</td></tr>`;

  const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bulletin — ${reportEscape(nameOf(student))}</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif}.sheet{max-width:980px;margin:24px auto;background:#fff;border:1px solid #dbe3ec;border-radius:18px;padding:28px;box-shadow:0 10px 35px rgba(15,23,42,.08)}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:18px}.school h1{margin:0 0 6px;font-size:25px}.school .label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#64748b}.logo{width:76px;height:76px;object-fit:contain}.student{margin:20px 0;display:flex;justify-content:space-between;gap:20px;padding:16px;border:1px solid #dbe3ec;border-radius:14px;background:#f8fafc}.bio{display:flex;gap:15px;align-items:center}.photo{width:78px;height:92px;object-fit:cover;border-radius:10px;border:1px solid #cbd5e1}.photoEmpty{width:78px;height:92px;border:1px dashed #cbd5e1;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px}.name{font-size:21px;font-weight:700}.muted{color:#64748b;font-size:13px;margin-top:4px}.cards{display:flex;gap:10px;flex-wrap:wrap}.card{min-width:115px;background:#fff;border:1px solid #dbe3ec;border-radius:10px;padding:10px 12px}.card small{display:block;color:#64748b;text-transform:uppercase;font-size:9px}.card strong{font-size:18px}.decision{margin-top:18px;padding:12px 14px;border-radius:10px;background:#eef2ff;font-weight:700}.tableWrap{overflow:hidden;border:1px solid #dbe3ec;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{padding:9px 7px;border-bottom:1px solid #e2e8f0;text-align:center}th{background:#0f172a;color:#fff}td.subject,th:first-child{text-align:left}.empty{padding:25px;color:#64748b}.footer{margin-top:18px;display:flex;justify-content:space-between;gap:15px;color:#64748b;font-size:10px}.actions{max-width:980px;margin:12px auto;text-align:right}.actions button{border:0;border-radius:8px;padding:10px 15px;cursor:pointer}@media print{body{background:#fff}.sheet{margin:0;max-width:none;border:0;border-radius:0;box-shadow:none;padding:0}.actions{display:none}}
</style></head><body><div class="actions"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div><main class="sheet">
<section class="top"><div class="school"><div class="label">Bulletin académique</div><h1>${reportEscape(conf.SCHOOL_NAME || "Établissement")}</h1><div class="muted">${reportEscape(conf.SCHOOL_ADDR || "")}</div><div class="muted">Année scolaire : ${reportEscape(conf.ACADEMIC_YEAR || conf.academicYear || "")}</div></div>${conf.SCHOOL_LOGO ? `<img class="logo" src="${reportEscape(conf.SCHOOL_LOGO)}" alt="Logo">` : ""}</section>
<section class="student"><div class="bio">${photo ? `<img class="photo" src="${reportEscape(photo)}" alt="Photo de l'élève">` : `<div class="photoEmpty">Photo</div>`}<div><div class="name">${reportEscape(nameOf(student) || sid)}</div><div class="muted">Matricule : ${reportEscape(sid)}</div><div class="muted">Classe : ${reportEscape(levelOf(student))} ${student.section ? `• Section : ${reportEscape(student.section)}` : ""}</div></div></div><div class="cards"><div class="card"><small>Moyenne</small><strong>${average.toFixed(2)}/100</strong></div><div class="card"><small>Présence</small><strong>${Number(att.presence || 0).toFixed(1)}%</strong></div><div class="card"><small>Décision</small><strong>${reportEscape(decision)}</strong></div></div></section>
<div class="decision">Résultat académique : ${reportEscape(decision)}</div>
<section style="margin-top:20px"><div class="tableWrap"><table><thead><tr><th>Matière</th>${headers.map(h=>`<th>${h}</th>`).join("")}<th>Moyenne</th><th>Max</th></tr></thead><tbody>${body}</tbody></table></div></section>
<section class="footer"><span>Présences : ${att.present || 0} • Absences : ${att.absent || 0} • Total : ${att.total || 0}</span><span>Paiements enregistrés : ${totalPaid.toFixed(2)}</span><span>Généré le ${reportEscape(reportDateFr())}</span></section>
</main></body></html>`;
  return { success:true, htmlReport:html, studentId:sid, fileName:`Bulletin_${sid}.html`, format:"HTML_PRINTABLE", canPrintToPdf:true };
}

export async function generateFullStudentReport(data, auth, env) {
  try {
    const result = await buildPrintableStudentReport(data, auth, env);
    if (result.success) await writeAudit(env, auth, "REPORT_GENERATED", `Bulletin/${result.studentId}`, { engine:data?.engine || "STANDARD", format:"HTML_PRINTABLE" });
    return result;
  } catch (e) { return { success:false, error:e.message }; }
}

export async function generateReportDownloadUrl(data, auth, env) {
  // The old Apps Script version created a Drive PDF URL. There is no Drive or
  // HtmlService equivalent in Workers, so return a print-ready report payload.
  const result = await generateFullStudentReport(data, auth, env);
  if (!result.success) return result;
  return { ...result, url:null, message:"Rapport prêt. Utilisez Imprimer / Enregistrer en PDF dans le rapport." };
}
