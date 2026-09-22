// grades.js — REAL port of Code.gs's grade actions, verified with
// Code.gs in context (unlike the earlier guessed version of this
// file). Real Sheet: 'grades', headers GradeID/HistoryID/StudentID/
// GradeLevelID/SubjectID/PeriodID/Score/Mention/TeacherID/ScoresJSON/
// Timestamp/UpdatedAt (Code.gs SHEET_DEFS). Ported functions:
//   - saveManualExamGrade_  → saveManualExamGrade  (Code.gs ~line 9243)
//   - getGrades_            → getGrades            (Code.gs ~line 9821)
//   - getExistingGrade_     → getExistingGrade      (Code.gs ~line 9955)
//   - updateGradeSubjects_  → updateGradeSubjects   (Code.gs ~line 9992)
//
// Remaining compatibility notes:
//   - saveMaternalMentions_ is now ported below as a dedicated non-numeric
//     mention write path.
//   - Code.gs's getSubjectMaxScore_ derives the grading ceiling from the
//     active student level curriculum (subject coefficient/max). This port
//     now resolves that curriculum before falling back to the school
//     MAX_SCORE setting, preserving the legacy 100 fallback when no
//     curriculum entry exists.
//   - NUM_PERIODS/TOTAL_TERMS-based "period beyond what this school
//     configured" rejection — same reasoning, enforced only if
//     `settings` has NUM_PERIODS/TOTAL_TERMS seeded.
//   - Legacy filterStudentsByViewerScope_ naming/scopeWarning fields are not
//     copied verbatim; server-side access is enforced by lib/accessScope.js.
//   - CacheService invalidation calls (_invalidateAiSystemSnapshot_,
//     PROMO_OVERVIEW_ cache, _clearStudentGradesCache) — no equivalent
//     cache exists yet on the Worker side, so nothing to invalidate.
//   - getAvailableExams_ / addQuizQuestion_ / getQuizQuestions_ /
//     updateExamSettings_ — quiz/exam-builder actions, separate domain.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { assertStudentAccess, loadViewer, canAccessStudent } from "../lib/accessScope.js";
import { loadSessionToken } from "../lib/session.js";
import { getSetting } from "../lib/settings.js";
import { saveChunkedCurriculum } from "./curriculum.js";

const PERIOD_RE = /^T[1-6]$/;

function authError() {
  return { success: false, error: "Non authentifié." };
}

async function currentUserId(env, auth) {
  if (!auth || !auth.token) return null;
  const session = await loadSessionToken(env.DB, auth.token);
  return session ? session.userId || session.email || null : null;
}

function safeParseJson(str) {
  if (str && typeof str === "object") return str;
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

function normalizeCurriculumLevel(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function getSubjectMaxScoreFromCurriculum(db, subjectId, historyId, studentId) {
  let levelId = "";
  if (historyId) {
    const h = await db.prepare(`SELECT grade_level_id FROM student_history WHERE history_id=? LIMIT 1`)
      .bind(historyId).first();
    levelId = String(h?.grade_level_id || "").trim();
  }
  if (!levelId && studentId) {
    const h = await db.prepare(`SELECT grade_level_id FROM student_history WHERE student_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1`)
      .bind(studentId).first();
    levelId = String(h?.grade_level_id || "").trim();
  }
  if (!levelId) return null;

  const rows = await db.prepare(`SELECT key,value FROM settings WHERE key LIKE 'CURRICULUM_%' OR key='SCHOOL_CURRICULUM'`).all();
  const wanted = normalizeCurriculumLevel(levelId);
  let curriculum = {};
  for (const r of rows.results || []) {
    const key = String(r.key || "").trim();
    const parsed = safeParseJson(r.value);
    if (key === "SCHOOL_CURRICULUM" && parsed && typeof parsed === "object" && Object.keys(parsed).length) {
      curriculum = parsed;
      break;
    }
  }
  if (!Object.keys(curriculum).length) {
    for (const r of rows.results || []) {
      const key = String(r.key || "").trim();
      if (!/^CURRICULUM_/i.test(key)) continue;
      const parsed = safeParseJson(r.value);
      if (parsed && typeof parsed === "object") {
        const level = key.replace(/^CURRICULUM_/i, "");
        curriculum[level] = parsed;
      }
    }
  }

  let subjects = null;
  for (const [key, value] of Object.entries(curriculum)) {
    if (normalizeCurriculumLevel(key) === wanted) {
      subjects = Array.isArray(value) ? value : null;
      break;
    }
  }
  if (!subjects) return null;

  const wantedSubject = String(subjectId || "").trim();
  const normalizedSubject = normalizeCurriculumLevel(wantedSubject);
  const subject = subjects.find(x => {
    if (!x || typeof x !== "object") return false;
    const ids = [x.subjectId, x.id, x.subject, x.name, x.label].map(v => normalizeCurriculumLevel(v));
    return ids.includes(normalizedSubject);
  });
  if (!subject) return null;

  const branches = Array.isArray(subject.branches) ? subject.branches : [];
  const branchSum = branches.reduce((sum,b) => sum + (Number(b?.max ?? b?.coeff ?? b?.points ?? b?.weight ?? 0) || 0), 0);
  const coeff = Number(subject.coeff ?? subject.coef ?? subject.points ?? 0);
  const max = branchSum > 0 ? branchSum : coeff;
  return Number.isFinite(max) && max > 0 ? max : null;
}

// ?action=getGrades&studentId=...&historyId=...
//
// Mirrors getGrades_'s "one row per period" expansion: the sheet (and
// here, the D1 row) stores every period's score merged into one JSON
// blob per (student, subject), but every real consumer of this action
// expects one entry per graded period with its own PeriodID/Score —
// see the FIX comment on getGrades_ in Code.gs for why that matters.
export async function getGrades(data, auth, env) {
  if (!auth || !auth.token) return authError();
  const orgId = await resolveOrgId(env);

  const studentId = String((data && (data.studentId || data.id || data.studentCode)) || "").trim();
  if (studentId) { const guard = await assertStudentAccess(env, auth, orgId, studentId); if (!guard.allowed) return { success:false, error:guard.error }; }
  const historyId = String((data && data.historyId) || "").trim();

  const clauses = ["org_id = ?", "deleted_at IS NULL"];
  const params = [orgId];
  if (studentId) {
    clauses.push("student_id = ?");
    params.push(studentId);
  }
  if (historyId) {
    clauses.push("history_id = ?");
    params.push(historyId);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, history_id, student_id, grade_level_id, subject_id, period_id, score,
            mention, teacher_id, scores_json, created_at, version, updated_at
     FROM grades WHERE ${clauses.join(" AND ")}
     ORDER BY updated_at DESC`
  )
    .bind(...params)
    .all();

  const viewer = await loadViewer(env, auth);
  const rows = [];
  for (const r of results || []) {
    const scopeStudent = { StudentCode:r.student_id, CurrentLevel:r.grade_level_id, Section:"" };
    if (viewer && !canAccessStudent(viewer, scopeStudent).allowed) continue;
    const scoresObj = safeParseJson(r.scores_json);
    const periodKeys = Object.keys(scoresObj).filter(
      (k) => PERIOD_RE.test(k) && scoresObj[k] !== "" && scoresObj[k] !== null && scoresObj[k] !== undefined
    );

    if (periodKeys.length) {
      for (const pk of periodKeys) {
        const raw = scoresObj[pk];
        const numeric = !isNaN(parseFloat(raw)) && isFinite(Number(raw));
        rows.push({
          GradeID: r.id,
          HistoryID: r.history_id,
          StudentID: r.student_id,
          GradeLevelID: r.grade_level_id,
          SubjectID: r.subject_id,
          PeriodID: pk,
          Score: numeric ? parseFloat(raw) : "",
          Mention: numeric ? "" : String(raw).trim(),
          TeacherID: r.teacher_id,
          ScoresJSON: scoresObj,
          Timestamp: r.created_at,
          UpdatedAt: r.updated_at,
        });
      }
    } else {
      // Legacy/empty row — fall back to the row's own fields as-is,
      // same as getGrades_'s "no usable ScoresJSON" branch.
      rows.push({
        GradeID: r.id,
        HistoryID: r.history_id,
        StudentID: r.student_id,
        GradeLevelID: r.grade_level_id,
        SubjectID: r.subject_id,
        PeriodID: r.period_id,
        Score: r.score,
        Mention: r.mention,
        TeacherID: r.teacher_id,
        ScoresJSON: scoresObj,
        Timestamp: r.created_at,
        UpdatedAt: r.updated_at,
      });
    }
  }

  return { success: true, data: rows };
}

// {action: "getExistingGrade", data: {studentCode, examTitle}}
// examTitle in Code.gs is really the SubjectID (the manual-grade modal
// calls it "exam title" but passes the subject id — see saveManualExamGrade_'s
// `obj.examTitle || obj.subjectId`).
export async function getExistingGrade(data, auth, env) {
  const orgId = await resolveOrgId(env);
  const studentCode = String((data && data.studentCode) || "").trim();
  const examTitle = String((data && (data.examTitle || data.subjectId)) || "").trim();
  if (!studentCode || !examTitle) return { found: false };
  const access = auth ? await assertStudentAccess(env, auth, orgId, studentCode) : {allowed:true};
  if (!access.allowed) return { success:false, error:access.error };

  const row = await env.DB.prepare(
    `SELECT score, scores_json FROM grades
     WHERE org_id = ? AND student_id = ? AND subject_id = ? AND deleted_at IS NULL`
  )
    .bind(orgId, studentCode, examTitle)
    .first();

  if (!row) return { found: false };
  return { found: true, grade: row.score, scoresJson: safeParseJson(row.scores_json) };
}

// {action: "saveManualExamGrade", data: {studentID|studentCode, historyId?,
//   examTitle|subjectId, periodId|period, grade|score}}
//
// Upserts the ONE row per (student, subject[, history]) the same way
// saveManualExamGrade_ does: merge this period's score into ScoresJSON,
// update Score/PeriodID to reflect the period just written.
export async function saveManualExamGrade(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const userId = await currentUserId(env, auth);
    const obj = data || {};

    const studentCode = String(obj.studentID || obj.studentCode || "").trim();
    const subjectId = String(obj.examTitle || obj.subjectId || obj.examSlug || "").trim();

    const periodRaw = obj.periodId || obj.period;
    if (!periodRaw) {
      return { success: false, error: "Période manquante. Sélectionnez une période avant d'enregistrer la note." };
    }
    const periodId = String(periodRaw).trim().toUpperCase();
    if (!PERIOD_RE.test(periodId)) {
      return { success: false, error: `Période invalide : "${periodRaw}". Attendu T1-T6.` };
    }

    const rawScore = obj.grade !== undefined && obj.grade !== null && String(obj.grade).trim() !== "" ? obj.grade : obj.score;
    const score = parseFloat(rawScore);
    if (!studentCode || !subjectId || isNaN(score)) {
      return { success: false, error: "Données manquantes (studentCode, subjectId, score)." };
    }
    const access = auth ? await assertStudentAccess(env, auth, orgId, studentCode) : {allowed:true};
    if (!access.allowed) return { success:false, error:access.error };

    if (score < 0) {
      return { success: false, error: "La note ne peut pas être négative." };
    }

    const historyId = String(obj.historyId || "").trim() || null;

    // Code.gs first derives the ceiling from the student's active
    // curriculum/subject. Only when that lookup has no usable subject
    // entry do we use the school-level MAX_SCORE setting.
    const curriculumMax = await getSubjectMaxScoreFromCurriculum(env.DB, subjectId, historyId, studentCode);
    const maxRaw = await getSetting(env.DB, "MAX_SCORE", await getSetting(env.DB, "maxScore", null));
    const configuredMax = Number(maxRaw);
    const maxScore = curriculumMax ?? (Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 100);
    if (score > maxScore) return { success:false, error:`La note ne peut pas dépasser ${maxScore} pour cette matière.` };
    const configuredPeriods = Math.max(2, Math.min(6, Number(await getSetting(env.DB,'NUM_PERIODS',await getSetting(env.DB,'TOTAL_TERMS',3))) || 3));
    if (Number(periodId.slice(1)) > configuredPeriods) return {success:false,error:`Période ${periodId} hors plage : cette école est configurée pour ${configuredPeriods} période(s).`};

    const existing = await env.DB.prepare(
      `SELECT id, scores_json, version FROM grades
       WHERE org_id = ? AND student_id = ? AND subject_id = ? AND IFNULL(history_id,'') = IFNULL(?, '')
         AND deleted_at IS NULL`
    )
      .bind(orgId, studentCode, subjectId, historyId)
      .first();

    const ts = new Date().toISOString();

    if (existing) {
      const sj = safeParseJson(existing.scores_json);
      sj[periodId] = score;
      const nextVersion = Number(existing.version) + 1;
      await env.DB.prepare(
        `UPDATE grades SET score = ?, period_id = ?, mention = NULL, scores_json = ?,
           version = ?, updated_at = ?, teacher_id = COALESCE(teacher_id, ?)
         WHERE id = ?`
      )
        .bind(score, periodId, JSON.stringify(sj), nextVersion, ts, userId, existing.id)
        .run();

      await writeAudit(env.DB, {
        table: "grades",
        rowId: existing.id,
        userId,
        deviceId: obj.deviceId,
        op: "update",
        diff: { subjectId, periodId, score },
      });

      return { success: true, message: "Note enregistrée.", id: existing.id, version: nextVersion };
    }

    const gradeId = "GRD-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    await env.DB.prepare(
      `INSERT INTO grades (id, history_id, student_id, org_id, grade_level_id, subject_id, period_id,
         score, mention, teacher_id, scores_json, created_at, version, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, NULL)`
    )
      .bind(
        gradeId,
        historyId,
        studentCode,
        orgId,
        obj.gradeLevelId || obj.levelId || null,
        subjectId,
        periodId,
        score,
        userId,
        JSON.stringify({ [periodId]: score }),
        ts,
        ts
      )
      .run();

    await writeAudit(env.DB, {
      table: "grades",
      rowId: gradeId,
      userId,
      deviceId: obj.deviceId,
      op: "insert",
      diff: { studentCode, subjectId, periodId, score },
    });

    return { success: true, message: "Note enregistrée.", id: gradeId, version: 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "updateGradeSubjects", data: {subjects: [...]}}
//
// SIMPLIFIED, not a full port: Code.gs's syncSubjectsInSettings_ writes
// into the full multi-tenant Settings/Register system (updateSaaSSettings_).
// This Worker doesn't have that system ported (see src/lib/settings.js's
// own disclaimer) — it just stores the subjects list as JSON under a
// `SUBJECTS` key in the flat `settings` table. Good enough for the
// grade-entry UI to read back its own subject list; not equivalent to
// the original's cross-school Settings sync.


export async function getStudentScores(data, auth, env) {
  if (!auth?.token) return authError();
  const studentCode=String(data?.studentCode||data?.studentId||data?.id||'').trim();
  if(!studentCode)return {success:true,data:[]};
  const orgId=await resolveOrgId(env);
  const access=await assertStudentAccess(env,auth,orgId,studentCode); if(!access.allowed)return {success:false,error:access.error};
  const historyId=String(data?.historyId||'').trim();
  const clauses=['org_id=?','student_id=?','deleted_at IS NULL']; const params=[orgId,studentCode];
  if(historyId){clauses.push('history_id=?');params.push(historyId);}
  const {results}=await env.DB.prepare(`SELECT subject_id,period_id,score,scores_json FROM grades WHERE ${clauses.join(' AND ')}`).bind(...params).all();
  const by={};
  for(const r of results||[]){const sub=String(r.subject_id||'').trim();if(!sub)continue;const item=by[sub]??={Subject:sub,T1:'',T2:'',T3:'',T4:'',T5:'',T6:'',_all:[]};const sj=safeParseJson(r.scores_json);const keys=Object.keys(sj).filter(k=>PERIOD_RE.test(k));if(keys.length){for(const k of keys){item[k]=sj[k];item._all.push(sj[k]);}}else if(PERIOD_RE.test(String(r.period_id||'').toUpperCase())){item[String(r.period_id).toUpperCase()]=r.score;item._all.push(r.score);}}
  return {success:true,data:Object.values(by).map(item=>{const vals=item._all.map(Number).filter(Number.isFinite);item.Score=vals.length?Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)):0;delete item._all;return item;})};
}

export async function saveMaternalMentions(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const studentCode = String(data?.studentCode || data?.studentID || data?.studentId || '').trim();
    const periodRaw = data?.periodId || data?.period;
    if (!studentCode) return {success:false,error:'studentCode manquant.'};
    if (!periodRaw) return {success:false,error:"Période manquante. Sélectionnez une période avant d'enregistrer les mentions."};
    const periodId=String(periodRaw).trim().toUpperCase();
    if(!PERIOD_RE.test(periodId)) return {success:false,error:`Période invalide : "${periodRaw}". Attendu T1-T6.`};
    const mentions=Array.isArray(data?.mentions)?data.mentions:[];
    if(!mentions.length)return {success:false,error:'Aucune mention a enregistrer.'};
    const access=await assertStudentAccess(env,auth,orgId,studentCode);
    if(!access.allowed)return {success:false,error:access.error};
    const periodsRaw=await getSetting(env.DB,'NUM_PERIODS',await getSetting(env.DB,'TOTAL_TERMS',3));
    const configured=Math.max(2,Math.min(6,Number(periodsRaw)||3));
    if(Number(periodId.slice(1))>configured)return {success:false,error:`Période ${periodId} hors plage : cette école est configurée pour ${configured} période(s).`};
    const hist=await env.DB.prepare(`SELECT history_id,grade_level_id FROM student_history WHERE org_id=? AND student_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1`).bind(orgId,studentCode).first();
    const rows=await env.DB.prepare(`SELECT id,history_id,grade_level_id,subject_id,scores_json,version FROM grades WHERE org_id=? AND student_id=? AND deleted_at IS NULL`).bind(orgId,studentCode).all();
    const existing=new Map((rows.results||[]).map(r=>[String(r.subject_id),r]));
    let saved=0;
    for(const m of mentions){
      const subjectId=String(m?.subjectId||m?.label||'').trim(); if(!subjectId)continue;
      const mention=String(m?.mention||'').trim();
      const row=existing.get(subjectId); const ts=new Date().toISOString();
      if(row){
        const sj=safeParseJson(row.scores_json); if(mention)sj[periodId]=mention; else delete sj[periodId];
        await env.DB.prepare(`UPDATE grades SET mention=?,period_id=?,scores_json=?,version=?,updated_at=? WHERE id=? AND org_id=?`).bind(mention||null,periodId,JSON.stringify(sj),Number(row.version)+1,ts,row.id,orgId).run();
        saved++;
      } else {
        const id='GRD-'+crypto.randomUUID().replace(/-/g,'').slice(0,8);
        await env.DB.prepare(`INSERT INTO grades(id,history_id,student_id,org_id,grade_level_id,subject_id,period_id,score,mention,teacher_id,scores_json,created_at,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,NULL,?,NULL,NULL,?,?,?,NULL)`).bind(id,hist?.history_id||null,studentCode,orgId,data?.levelId||data?.gradeLevelId||hist?.grade_level_id||null,subjectId,periodId,mention||null,JSON.stringify(mention?{[periodId]:mention}:{}),ts,1,ts).run();
        saved++;
      }
    }
    await writeAudit(env.DB,{table:'grades',rowId:studentCode,userId:(await currentUserId(env,auth)),deviceId:data?.deviceId,op:'maternal_mentions',diff:{periodId,count:saved}});
    return {success:true,saved};
  }catch(e){return {success:false,error:e.message};}
}

export async function updateGradeSubjects(data, auth, env) {
  // Code.gs delegates this action to syncSubjectsInSettings_(), which in turn
  // calls saveChunkedCurriculum_().  Storing only a flat SUBJECTS key was not
  // equivalent: it could make the grade-entry UI appear updated while the
  // real CURRICULUM_<LEVEL> / SCHOOL_CURRICULUM structures remained stale.
  try {
    if (!auth?.token) return authError();
    const payload = data || {};

    // Accept the legacy {subjects:[...]} shape as well as the real curriculum
    // map {levelId:[subjects...]}.  For the legacy shape, preserve the current
    // curriculum levels and replace their subject arrays only when there is a
    // single explicit level supplied by the caller.
    if (Array.isArray(payload.subjects)) {
      const levelId = String(payload.levelId || payload.gradeLevelId || payload.level || '').trim();
      if (!levelId) {
        return { success:false, error:'levelId requis pour synchroniser la liste des matières.' };
      }
      return saveChunkedCurriculum({ [levelId]: payload.subjects }, auth, env);
    }

    const curriculum = payload.curriculum && typeof payload.curriculum === 'object'
      ? payload.curriculum
      : payload;
    if (!curriculum || typeof curriculum !== 'object' || Array.isArray(curriculum)) {
      return { success:false, error:'Curriculum invalide.' };
    }
    return saveChunkedCurriculum(curriculum, auth, env);
  } catch (e) {
    return { success:false, error:e?.message || String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Maternelle class-wide curriculum checklist compatibility port.
// Code.gs stores one row per (ClassKey, RowKey, Period) in
// maternal_curriculum_checks. Empty Mention is a deliberate unchecked state.
// ─────────────────────────────────────────────────────────────────────────────
export async function getMaternalCurriculumChecks(data, auth, env) {
  if (!auth?.token) return {success:false,error:'Session invalide.'};
  const classKey = String(data?.classKey || '').trim();
  if (!classKey) return {success:false,error:'classKey manquant.'};
  const org = await resolveOrgId(env);
  const {results} = await env.DB.prepare(`SELECT row_key,period,mention FROM maternal_curriculum_checks
    WHERE org_id=? AND class_key=? AND deleted_at IS NULL ORDER BY updated_at DESC`)
    .bind(org,classKey).all();
  const out={};
  for(const r of results||[]){
    const rowKey=String(r.row_key||'').trim(), period=String(r.period||'').trim(), mention=String(r.mention||'').trim();
    if(!rowKey || !period || !mention) continue;
    if(!out[rowKey]) out[rowKey]={};
    out[rowKey][period]=mention;
  }
  return {success:true,data:out};
}

export async function saveMaternalCurriculumCheck(data, auth, env) {
  if (!auth?.token) return {success:false,error:'Session invalide.'};
  const classKey=String(data?.classKey||'').trim();
  const rowKey=String(data?.rowKey||'').trim();
  const periodRaw=data?.period || data?.periodId;
  if(!classKey) return {success:false,error:'classKey manquant.'};
  if(!rowKey) return {success:false,error:'rowKey manquant.'};
  if(!periodRaw) return {success:false,error:'Période manquante.'};
  const period=String(periodRaw).trim().toUpperCase();
  if(!/^T[1-6]$/.test(period)) return {success:false,error:`Période invalide : "${periodRaw}". Attendu T1-T6.`};
  const mention=String(data?.mention||'').trim();
  const org=await resolveOrgId(env), ts=new Date().toISOString();
  const existing=await env.DB.prepare(`SELECT id FROM maternal_curriculum_checks WHERE org_id=? AND class_key=? AND row_key=? AND period=? AND deleted_at IS NULL LIMIT 1`)
    .bind(org,classKey,rowKey,period).first();
  if(existing){
    await env.DB.prepare(`UPDATE maternal_curriculum_checks SET mention=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND org_id=?`)
      .bind(mention,String((await loadViewer(env,auth))?.id||''),ts,existing.id,org).run();
  } else {
    const id=`MCC_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,7).toUpperCase()}`;
    const viewerObj=await loadViewer(env,auth);
    await env.DB.prepare(`INSERT INTO maternal_curriculum_checks(id,org_id,check_id,class_key,row_key,period,mention,updated_by,created_at,updated_at,version,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,NULL)`)
      .bind(id,org,id,classKey,rowKey,period,mention,String(viewerObj?.id||''),ts,ts).run();
  }
  await writeAudit(env.DB,{table:'maternal_curriculum_checks',rowId:`${classKey}/${rowKey}/${period}`,userId:(await loadViewer(env,auth))?.id||'',op:'upsert',diff:{mention}});
  return {success:true};
}
