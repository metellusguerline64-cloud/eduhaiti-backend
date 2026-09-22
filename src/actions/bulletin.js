// bulletin.js — port of the Code.gs bulletin-download-gating group closed
// out by 0021's "still missing" list:
//   - getStudentBulletinData_             → getStudentBulletinData             (Code.gs ~line 14588)
//   - checkStudentBulletinDownloadAllowed_ → checkStudentBulletinDownloadAllowed (Code.gs ~line 1188)
//   - _evaluateStudentBulletinPaymentGate_ → evaluateBulletinPaymentGate (private helper, ~line 1144)
//   - _buildHomeworkBulletinLines_        → buildHomeworkBulletinLines (private helper, ~line 14650)
//
// getStudentBulletinData composes three already-ported pieces instead of
// re-querying D1 directly — same values, no duplicated query logic:
//   - getImmersiveData (reports.js) for studentName/studentPhoto/
//     finalYearlyAvg/decision/subjectAnalysis/meta.currentLevel
//   - getStudentFinanceProfile (payments.js) for the totalDue/totalPaid/
//     totalDebt the payment gate reads
//   - listStudentHomework (media_homework.js) for the SINGLE_SUBJECT_MODE
//     homework-as-bulletin-line rows
//
// The payment gate (SP_BULLETIN_PAYMENT_GATE) is off by default — existing
// schools see no behavior change until an admin turns it on. When on, it
// only ever gates a STUDENT-role portal session viewing/downloading their
// OWN bulletin; staff/teacher/admin sessions generating a student's
// bulletin on their behalf are never restricted by it, same as the
// original. Zero Fallback throughout: a misconfigured Finance setup, an
// unreadable settings row, or a lookup error must never be mistaken for
// an unpaid student — the gate only blocks on a real, computed shortfall.
//
// Deliberately NOT ported: nothing in this group has an intentional gap —
// both actions are read-only/permission checks with no side effects to
// simplify away.

import { resolveOrgId } from "../lib/org.js";
import { assertStudentAccess, loadViewer } from "../lib/accessScope.js";
import { getImmersiveData } from "./reports.js";
import { getStudentFinanceProfile } from "./payments.js";
import { listStudentHomework } from "./media_homework.js";

async function loadConfig(db) {
  const { results } = await db.prepare(`SELECT key,value FROM settings`).all();
  const out = {};
  for (const r of results || []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

// Direct port of readBooleanConfigValue_ (Code.gs ~line 1057).
function readBooleanConfigValue(cfg, key, defaultValue) {
  if (!cfg || typeof cfg !== "object" || cfg[key] === undefined || cfg[key] === null || cfg[key] === "") {
    return !!defaultValue;
  }
  const raw = cfg[key];
  if (typeof raw === "string") {
    const txt = raw.trim().toUpperCase();
    if (["TRUE", "1", "YES", "ON", "OUI"].includes(txt)) return true;
    if (["FALSE", "0", "NO", "OFF", "NON"].includes(txt)) return false;
  }
  return !!raw;
}

// Direct port of _requireConfigMaxScore_ / _getConfigMaxScore_ (Code.gs
// ~line 25-35) — same four config-key fallback chain, same "Zero
// Fallback" throw when nothing is configured.
function requireConfigMaxScore(cfg, context) {
  const c = cfg || {};
  const v = Number(c.MAX_SCORE || c.maxScore || c.max_score || c.GRADE_MAX || c.gradeMax || 0);
  if (Number.isFinite(v) && v > 0) return v;
  const ctx = context ? ` (${context})` : "";
  throw new Error(`MAX_SCORE non configuré${ctx}. Allez dans Paramètres › Évaluation.`);
}

// Port of _evaluateStudentBulletinPaymentGate_ (Code.gs ~line 1144).
// action is 'VIEW' or 'DOWNLOAD'; SP_BULLETIN_PAYMENT_SCOPE ('DOWNLOAD'
// default, or 'VIEW'/'BOTH') decides which action(s) the gate applies to.
async function evaluateBulletinPaymentGate(env, orgId, studentId, conf, auth, action) {
  const gateOn = readBooleanConfigValue(conf, "SP_BULLETIN_PAYMENT_GATE", false);
  if (!gateOn) return { allowed: true };

  const scope = String((conf && conf.SP_BULLETIN_PAYMENT_SCOPE) || "DOWNLOAD").trim().toUpperCase();
  const appliesToThisAction = scope === "BOTH" || scope === action;
  if (!appliesToThisAction) return { allowed: true };

  let finance;
  try {
    finance = await getStudentFinanceProfile({ studentId }, auth, env);
  } catch {
    return { allowed: true }; // can't verify — never block on our own error
  }
  if (!finance || finance.success === false) return { allowed: true };

  const due = Number(finance.totalDue || 0) || 0;
  if (due <= 0) return { allowed: true }; // fees not configured for this student — nothing to gate against

  const paid = Number(finance.totalPaid || 0) || 0;
  const outstanding = Number(finance.totalDebt || 0) || 0;
  const paidPct = Math.max(0, Math.min(100, (paid / due) * 100));

  let thresholdPct = Number(conf && conf.SP_BULLETIN_PAYMENT_THRESHOLD_PCT);
  if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) thresholdPct = 100;
  thresholdPct = Math.min(100, thresholdPct);

  if (paidPct + 0.001 >= thresholdPct) {
    return { allowed: true, paidPct: Math.round(paidPct * 10) / 10, thresholdPct, due, paid, outstanding };
  }
  return {
    allowed: false,
    reason: "payment",
    paidPct: Math.round(paidPct * 10) / 10,
    thresholdPct, due, paid, outstanding,
    message: `Bulletin indisponible : ${Math.round(paidPct)}% des frais payés — ${thresholdPct}% requis avant consultation/téléchargement. Solde dû : ${outstanding}`,
  };
}

// Port of _buildHomeworkBulletinLines_ (Code.gs ~line 14650) —
// SINGLE_SUBJECT_MODE bulletin rows built from graded homework instead of
// classic subjects. Wrapped in try/catch, same as the original: a failure
// here (e.g. MAX_SCORE not configured) silently yields no rows rather
// than breaking the whole bulletin.
async function buildHomeworkBulletinLines(env, auth, studentId, className, singleSubject, cfg) {
  try {
    const listed = await listStudentHomework({ studentId, className }, auth, env);
    const rows = listed?.rows || [];
    if (!rows.length) return [];

    let numPeriods = 3;
    const n = Number(cfg.NUM_PERIODS || cfg.TOTAL_TERMS || 3);
    if (Number.isFinite(n) && n >= 2 && n <= 5) numPeriods = n;

    const coefDefault = (singleSubject && Number(singleSubject.coef)) || 1;
    const bulletinScale = requireConfigMaxScore(cfg, "bulletin de devoirs");

    return rows
      .filter((r) => r && r.status === "GRADED" && Number(r.max_score) > 0)
      .map((r) => {
        const max = Number(r.max_score) || bulletinScale;
        const raw = Number(r.score) || 0;
        const onScale = Math.round((raw / max) * bulletinScale * 10) / 10;
        const periodScores = [];
        for (let i = 0; i < numPeriods; i++) periodScores.push(onScale);
        return {
          subject: String(r.title || "").trim() || "Devoir",
          score: onScale,
          coeff: coefDefault,
          max,
          due: r.due_date || "",
          periodScores,
          rawScore: raw,
          homeworkId: r.id || "",
        };
      });
  } catch {
    return [];
  }
}

// {action: "getStudentBulletinData", data: {studentId}}
export async function getStudentBulletinData(data, auth, env) {
  try {
    const sid = String(data?.studentId || data?.id || "").trim();
    const orgId = await resolveOrgId(env);
    const guard = await assertStudentAccess(env, auth, orgId, sid);
    if (!guard.allowed) return { success: false, error: guard.error };

    // Payment-based VIEW gate — applies only to the student's own portal
    // session; staff/teacher/admin opening a student's bulletin on their
    // behalf are never restricted here.
    let cfgForBulletin = null;
    if (guard.viewer && guard.viewer.role === "STUDENT") {
      cfgForBulletin = await loadConfig(env.DB);
      const gate = await evaluateBulletinPaymentGate(env, orgId, sid, cfgForBulletin, auth, "VIEW");
      if (!gate.allowed) {
        return { success: false, error: gate.message, paymentBlocked: true, paymentGate: gate };
      }
    }

    const immersive = await getImmersiveData({ id: sid }, auth, env);
    if (!immersive.success) return { success: false, error: immersive.error };
    const currentLevel = String(
      (immersive.meta && (immersive.meta.currentLevel || immersive.meta.historicClass)) || ""
    ).trim();

    // Mode mono-matière : bulletin bâti sur les titres de devoirs plutôt
    // que sur les matières classiques.
    let scores = immersive.subjectAnalysis;
    let singleSubjectMode = false;
    let singleSubject = null;
    try {
      const cfg = cfgForBulletin || (await loadConfig(env.DB));
      if (readBooleanConfigValue(cfg, "SINGLE_SUBJECT_MODE", false)) {
        singleSubjectMode = true;
        singleSubject = {
          name: String(cfg.SINGLE_SUBJECT_NAME || "Cours").trim(),
          code: String(cfg.SINGLE_SUBJECT_CODE || "").trim(),
          coef: Number(cfg.SINGLE_SUBJECT_COEF || 1) || 1,
        };
        scores = await buildHomeworkBulletinLines(env, auth, sid, currentLevel, singleSubject, cfg);
      }
    } catch {
      // same as the original: a single-subject build failure never breaks
      // the classic bulletin path above it.
    }

    return {
      success: true,
      singleSubjectMode,
      singleSubject,
      student: {
        id: sid,
        name: immersive.studentName,
        photo: immersive.studentPhoto,
        level: currentLevel,
        scores,
        periodAvg: immersive.finalYearlyAvg,
        decision: immersive.decision,
        subjectAnalysis: immersive.subjectAnalysis,
        singleSubjectMode,
        singleSubject,
        meta: immersive.meta || {},
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "checkStudentBulletinDownloadAllowed", data: {studentId}} —
// student-portal preflight called right before the "Télécharger" button
// renders/saves a bulletin file. Staff/admin sessions always pass
// through unrestricted — this only ever gates a student's own
// self-service download, via pt_download_bulletin + the optional
// payment condition.
export async function checkStudentBulletinDownloadAllowed(data, auth, env) {
  try {
    const sid = String(data?.studentId || "").trim();
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success: false, error: "Session invalide." };
    if (viewer.role !== "STUDENT") return { success: true, allowed: true };

    const perms = viewer.permissions || {};
    // Security hardening: a STUDENT may only preflight/download their own
    // bulletin. Never trust a client-supplied studentId for the finance gate.
    const ownStudentId = String(viewer.id || viewer.userId || '').trim();
    if (!sid || !ownStudentId || sid.toLowerCase() !== ownStudentId.toLowerCase()) {
      return {
        success: true,
        allowed: false,
        reason: "scope",
        message: "Vous ne pouvez télécharger que votre propre bulletin.",
      };
    }
    if (!perms.pt_download_bulletin) {
      return {
        success: true,
        allowed: false,
        reason: "permission",
        message: "Le téléchargement du bulletin n'est pas activé pour votre compte. Contactez votre école.",
      };
    }

    const orgId = await resolveOrgId(env);
    const conf = await loadConfig(env.DB);
    const gate = await evaluateBulletinPaymentGate(env, orgId, sid, conf, auth, "DOWNLOAD");
    if (!gate.allowed) {
      return { success: true, allowed: false, ...gate };
    }
    return { success: true, allowed: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
