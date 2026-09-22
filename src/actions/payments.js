// payments.js — Finance parity finalization against Code.gs.
// The Worker keeps the same Finance contract while adapting persistence to D1/R2.
// Coverage: student payment history, scheduled tuition due, class payment-method
// restrictions, partial/overpayment rules, late penalties, smart period labels,
// cashier display names, idempotency, void/edit, finance profile, and online
// payment approval/rejection.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { assertStudentAccess } from "../lib/accessScope.js";
import { loadSessionToken } from "../lib/session.js";
import { getSetting } from "../lib/settings.js";

function authError() {
  return { success: false, error: "Non authentifié." };
}

async function currentViewer(env, auth) {
  if (!auth || !auth.token) return null;
  const session = await loadSessionToken(env.DB, auth.token);
  if (!session) return null;
  return { userId: session.userId || session.email || null, email: session.email || "" };
}

function nowIso() {
  return new Date().toISOString();
}

// Same UTC-midnight-vs-local-time fix recordNewPayment_ carries: a
// date-only string ("2026-08-06") from an <input type="date"> picker
// gets today's actual clock time stamped onto it, instead of every
// payment recorded this way showing an identical fixed time.
function resolvePaymentDate(raw) {
  if (!raw) return nowIso();
  const rawStr = String(raw).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawStr);
  if (dateOnly) {
    const now = new Date();
    const local = new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );
    if (!isNaN(local.getTime())) return local.toISOString();
    return nowIso();
  }
  const parsed = new Date(rawStr);
  return isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

async function activeHistoryIdFor(env, orgId, studentId) {
  const row = await env.DB.prepare(
    `SELECT history_id FROM student_history
     WHERE org_id = ? AND student_id = ? AND status = 'ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`
  )
    .bind(orgId, studentId)
    .first();
  return row ? row.history_id : null;
}

async function generateReceiptId(env, orgId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = "REC-" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    const exists = await env.DB.prepare(`SELECT 1 FROM payments WHERE org_id = ? AND id = ?`)
      .bind(orgId, candidate)
      .first();
    if (!exists) return candidate;
  }
  return "REC-" + Date.now().toString(36).toUpperCase();
}

function paymentRowToApi(r) {
  return {
    ReceiptID: r.id,
    HistoryID: r.history_id,
    StudentID: r.student_id,
    StudentName: r.student_name,
    Description: r.description,
    Amount: r.amount,
    CashierEmail: r.cashier_email,
    Status: r.status,
    Notes: r.notes,
    Date: r.payment_date,
    Reference: r.reference,
    Version: r.version,
    UpdatedAt: r.updated_at,
    CashierName: r.cashier_name || (r.cashier_email ? String(r.cashier_email).split("@")[0] : ""),
  };
}

// ?action=getStudentPayments&studentId=...&historyId=...&allYears=true
export async function getStudentPayments(data, auth, env) {
  if (!auth || !auth.token) return authError();
  const orgId = await resolveOrgId(env);
  const obj = data || {};
  const studentId = String(obj.studentId || obj.id || "").trim();
  if (studentId) { const guard = auth ? await assertStudentAccess(env, auth, orgId, studentId) : {allowed:true}; if (!guard.allowed) return { success:false, error:guard.error }; }
  const includeAllYears = obj.allYears === true || obj.includeAllYears === true;
  let historyId = obj.historyId ? String(obj.historyId).trim() : "";

  if (!historyId && !includeAllYears && studentId) {
    historyId = (await activeHistoryIdFor(env, orgId, studentId)) || "";
  }

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
    `SELECT p.id, p.history_id, p.student_id, p.student_name, p.description, p.amount, p.cashier_email,
            p.status, p.notes, p.payment_date, p.reference, p.version, p.updated_at,
            COALESCE((SELECT u.name FROM users u WHERE u.deleted_at IS NULL AND (u.email=p.cashier_email OR u.user_id=p.cashier_email) LIMIT 1), '') AS cashier_name
     FROM payments p WHERE ${clauses.join(" AND ")}
     ORDER BY payment_date DESC`
  )
    .bind(...params)
    .all();

  return { success: true, data: (results || []).map(paymentRowToApi) };
}


function parseConfigValue(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  const raw = String(value).trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normFinanceToken(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isTuitionPaymentPayload(payload) {
  const desc = String(payload?.designation || payload?.paymentType || payload?.description || '').toLowerCase();
  return /scolar|tuition|mensuel|versement/.test(desc);
}

function tuitionFrequencyDivisor(conf) {
  const f = String(conf?.TUITION_FREQUENCY || conf?.tuitionFrequency || 'ANNUAL').trim().toUpperCase();
  if (f === 'MONTHLY' || f === 'MENSUEL') return 10;
  if (f === 'TRIMESTER' || f === 'TRIMESTRIEL' || f === 'QUARTERLY') return 3;
  if (f === 'SEMESTER' || f === 'SEMESTRIEL' || f === 'BIANNUAL') return 2;
  return 1;
}

function amountFromFinancePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (Number(plan.instTotal) > 0) return Number(plan.instTotal);
  // Code.gs deliberately treats monthly.amount as the configured amount here;
  // it does NOT multiply by monthly.count in getExpectedTuitionAmountForStudent_.
  if (plan.monthly && Number(plan.monthly.amount) > 0) return Number(plan.monthly.amount);
  if (Array.isArray(plan.installments)) {
    const total = plan.installments.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0);
    if (total > 0) return total;
  }
  return null;
}

async function studentFinanceContext(env, orgId, studentId) {
  const row = await env.DB.prepare(`SELECT s.student_code,s.first_name,s.last_name,s.current_level,
      h.history_id,h.grade_level_id
    FROM students s LEFT JOIN student_history h
      ON h.org_id=s.org_id AND h.student_id=s.student_code AND h.status='ACTIVE'
    WHERE s.org_id=? AND (s.student_code=? OR s.id=?) AND s.deleted_at IS NULL
    ORDER BY h.updated_at DESC LIMIT 1`).bind(orgId, studentId, studentId).first();
  return row || null;
}

function resolvePlanForContext(conf, level) {
  const plans = parseConfigValue(conf?.FIN_PAYMENT_PLANS, {}) || {};
  const lvl = String(level || '').trim();
  const cycle = normFinanceToken(lvl).replace(/\s+/g, '_');
  const classKey = 'class_' + lvl.replace(/\s+/g, '_').toLowerCase();
  const cycleKey = 'cycle_' + cycle;
  if (plans[classKey] && typeof plans[classKey] === 'object') return plans[classKey];
  if (plans[cycleKey] && typeof plans[cycleKey] === 'object') return plans[cycleKey];
  if (plans.global && typeof plans.global === 'object') return plans.global;
  const levelLc = lvl.toLowerCase();
  const cycleLc = cycle.toLowerCase();
  if (levelLc || cycleLc) {
    const key = Object.keys(plans).find(k =>
      ((levelLc && k.toLowerCase().includes(levelLc)) || (cycleLc && k.toLowerCase().includes(cycleLc))) &&
      plans[k] && typeof plans[k] === 'object'
    );
    if (key) return plans[key];
  }
  const legacy = parseConfigValue(conf?.classPaymentPlans, {}) || {};
  if (lvl && legacy && typeof legacy === 'object') {
    const key = legacy[lvl] ? lvl : Object.keys(legacy).find(k => normFinanceToken(k) === normFinanceToken(lvl));
    if (key && legacy[key] && typeof legacy[key] === 'object') return legacy[key];
  }
  return null;
}

export async function resolveExpectedTuition(env, orgId, studentId, conf, context = null) {
  const ctx = context || await studentFinanceContext(env, orgId, studentId);
  const level = String(ctx?.grade_level_id || ctx?.current_level || '').trim();
  const mode = String(conf?.TUITION_MODE || 'GLOBAL').trim().toUpperCase();
  const plan = resolvePlanForContext(conf, level);
  let amount = amountFromFinancePlan(plan);
  const byClass = parseConfigValue(conf?.TUITION_BY_CLASS, {}) || {};
  const byCycle = parseConfigValue(conf?.TUITION_BY_CYCLE, {}) || {};
  if (mode === 'BY_CLASS') {
    const key = Object.keys(byClass).find(k => normFinanceToken(k) === normFinanceToken(level));
    if (key) amount = Number(byClass[key]) || amount;
  } else if (mode === 'BY_CYCLE') {
    const cycle = normFinanceToken(level);
    const key = Object.keys(byCycle).find(k => normFinanceToken(k) === cycle);
    if (key) amount = Number(byCycle[key]) || amount;
  } else if (mode === 'GLOBAL') {
    amount = Number(conf?.TUITION_AMOUNT_GLOBAL) || amount;
  }
  if (!(Number(amount) > 0)) {
    const key = Object.keys(byClass).find(k => normFinanceToken(k) === normFinanceToken(level));
    if (key) amount = Number(byClass[key]) || 0;
  }
  if (!(Number(amount) > 0)) amount = Number(conf?.TUITION_AMOUNT_GLOBAL || conf?.TUITION_AMOUNT || 0) || 0;
  return { amount: Number(amount) > 0 ? Number(amount) : 0, level, plan, context: ctx };
}

async function tuitionOutstanding(env, orgId, studentId, historyId, conf, context = null) {
  const tuition = await resolveExpectedTuition(env, orgId, studentId, conf, context);
  if (!(tuition.amount > 0)) return null;
  const clauses = `org_id=? AND student_id=? AND deleted_at IS NULL AND status NOT IN ('VOID','CANCELLED','ANNULE','REFUNDED')`;
  const params = [orgId, studentId];
  if (historyId) { params.push(historyId); }
  const q = historyId
    ? `SELECT amount FROM payments WHERE ${clauses} AND history_id=?`
    : `SELECT amount FROM payments WHERE ${clauses}`;
  const rows = (await env.DB.prepare(q).bind(...params).all()).results || [];
  const paidYear = rows.reduce((sum,r) => sum + (Number(r.amount) || 0), 0);
  const fullOutstanding = Math.max(0, tuition.amount - paidYear);
  const divisor = tuitionFrequencyDivisor(conf);
  const expectedPerPeriod = tuition.amount / Math.max(1, divisor);
  const plan = tuition.plan;
  const installments = Array.isArray(plan?.installments) ? plan.installments :
    (Array.isArray(plan?.predefinedPayments) ? plan.predefinedPayments : []);
  const today = new Date().toISOString().slice(0,10);
  let scheduled = 0;
  for (const item of installments) {
    const a = Number(item?.amount) || 0;
    if (a > 0 && (!item?.dueDate || String(item.dueDate).slice(0,10) <= today)) scheduled += a;
  }
  const dueNow = scheduled > 0
    ? Math.max(0, Math.min(scheduled - paidYear, fullOutstanding))
    : Math.min(expectedPerPeriod, fullOutstanding);
  return { expectedAnnual: tuition.amount, expectedPerPeriod, paidYear,
    nextInstallment: Math.min(expectedPerPeriod, fullOutstanding), dueNow, fullOutstanding,
    level: tuition.level, plan };
}

function allowedPaymentMethods(conf, level) {
  const raw = conf?.classPaymentTypes;
  if (!raw || !level) return null;
  const map = parseConfigValue(raw, null);
  if (!map || typeof map !== 'object') return null;
  if (Array.isArray(map[level])) return map[level];
  const key = Object.keys(map).find(k => normFinanceToken(k) === normFinanceToken(level));
  return key && Array.isArray(map[key]) ? map[key] : null;
}

function smartTuitionDescription(payload, info, conf, paid) {
  let description = String(payload?.designation || payload?.description || 'Paiement').trim();
  if (!info) return description || 'Paiement';
  const generic = !description || description === 'Paiement' || /^frais de scolar/i.test(description) ||
    description === 'scolarité' || description === 'Frais de scolarité';
  if (!generic) return description;
  const freq = String(conf?.TUITION_FREQUENCY || conf?.tuitionFrequency || 'ANNUAL').trim().toUpperCase();
  const divisor = tuitionFrequencyDivisor(conf);
  const periodsPaid = divisor > 1 && info.expectedPerPeriod > 0
    ? Math.floor((info.paidYear - paid) / info.expectedPerPeriod) : 0;
  const period = Math.min(Math.max(1, periodsPaid + 1), divisor);
  const partial = paid < info.nextInstallment && info.nextInstallment > 0;
  if (freq === 'MONTHLY' || freq === 'MENSUEL') return partial ? `Paiement partiel - Mois ${period}/${divisor}` : `Frais mensuel - Mois ${period}/${divisor}`;
  if (freq === 'TRIMESTER' || freq === 'TRIMESTRIEL' || freq === 'QUARTERLY') return partial ? `Versement partiel ${period}/${divisor}` : `Versement ${period}/${divisor}`;
  if (freq === 'SEMESTER' || freq === 'SEMESTRIEL' || freq === 'BIANNUAL') return partial ? `Versement partiel ${period}/2` : `Versement ${period}/2`;
  return description || 'Paiement';
}

function penaltyForPayment(conf, info, isTuition) {
  if (!isTuition || !info || !(Number(conf?.FIN_PENALTY_AMOUNT) > 0)) return 0;
  const grace = Math.max(0, parseInt(conf?.FIN_GRACE_PERIOD || 0, 10) || 0);
  const today = new Date();
  const yearStart = new Date(today.getFullYear(), 8, 1);
  const overdueDays = Math.floor((today - yearStart) / 86400000);
  if (overdueDays <= grace) return 0;
  const type = String(conf?.FIN_PENALTY_TYPE || 'FIXED').trim().toUpperCase();
  const recurrence = String(conf?.FIN_PENALTY_RECURRENCE || 'ONCE').trim().toUpperCase();
  let penalty = type === 'PERCENT' || type === 'PERCENTAGE'
    ? info.expectedPerPeriod * Number(conf.FIN_PENALTY_AMOUNT) / 100
    : Number(conf.FIN_PENALTY_AMOUNT);
  if (recurrence === 'MONTHLY') penalty *= Math.max(1, Math.floor((overdueDays - grace) / 30));
  return Math.round(Math.max(0, penalty) * 100) / 100;
}

// {action: "recordNewPayment", data: {studentId, studentName?, amountPaid|amount,
//   amountDue?, designation|description?, method?, reference|ref?, paymentDate?,
//   historyId?, clientRequestId?, deviceId?}}
export async function recordNewPayment(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await currentViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const payload = data || {};

    const studentId = String(payload.studentId || payload.id || "").trim();
    if (studentId) { const access=await assertStudentAccess(env,auth,orgId,studentId); if(!access.allowed) return {success:false,error:access.error}; }
    if (!studentId) return { success: false, error: "studentId requis." };
    const access = auth ? await assertStudentAccess(env, auth, orgId, studentId) : {allowed:true};
    if (!access.allowed) return { success:false, error:access.error };

    const paid = Number(
      payload.amountPaid !== undefined && payload.amountPaid !== null ? payload.amountPaid : payload.amount
    );
    if (!Number.isFinite(paid) || paid <= 0) {
      return { success: false, error: "Montant payé invalide." };
    }

    const minAmtSetting = await getSetting(env.DB, "PAY_MIN_AMOUNT");
    const minAmt = parseFloat(minAmtSetting) || 0;
    const currency = (await getSetting(env.DB, "CURRENCY")) || "HTG";
    if (minAmt > 0 && paid < minAmt) {
      return { success: false, error: `Versement minimum requis: ${minAmt} ${currency}.` };
    }

    // Idempotency: a retried submission with the same clientRequestId
    // returns the existing receipt instead of writing a duplicate row.
    const clientReqId = String(payload.clientRequestId || "").trim();
    if (clientReqId) {
      const existing = await env.DB.prepare(
        `SELECT id, amount, status, payment_date FROM payments
         WHERE org_id = ? AND client_request_id = ? AND deleted_at IS NULL`
      )
        .bind(orgId, clientReqId)
        .first();
      if (existing) {
        return {
          success: true,
          receiptId: existing.id,
          receiptNumber: existing.id,
          status: existing.status,
          amountPaid: existing.amount,
          currency,
          idempotentReplay: true,
          cashierEmail: viewer.email,
          message: "Encaissement déjà enregistré (tentative répétée détectée).",
        };
      }
    }

    const historyId = String(payload.historyId || '').trim() || (await activeHistoryIdFor(env, orgId, studentId));
    const isTuition = payload.isTuition === true || isTuitionPaymentPayload(payload);
    const context = await studentFinanceContext(env, orgId, studentId);
    const conf = await loadFinanceConfig(env);
    const scheduleInfo = isTuition ? await tuitionOutstanding(env, orgId, studentId, historyId, conf, context) : null;
    const rawDue = Number(payload.amountDue);
    const due = scheduleInfo ? scheduleInfo.dueNow : (Number.isFinite(rawDue) && rawDue > 0 ? rawDue : paid);
    const reportedDue = scheduleInfo ? scheduleInfo.fullOutstanding : due;

    const allowPartialRaw = String((await getSetting(env.DB, "PAY_ALLOW_PARTIAL")) ?? "true")
      .trim()
      .toLowerCase();
    const allowPartial = !["false", "0", "no", "non"].includes(allowPartialRaw);

    let status = "PAID";
    let notes = `Via ${payload.method || "Caisse"}`;
    const finalAmt = paid;

    if (paid < due) {
      if (!allowPartial) {
        return {
          success: false,
          error: `Les paiements partiels sont désactivés. Montant attendu: ${due} ${currency}.`,
        };
      }
      status = "PARTIAL";
      notes += ` | Solde dû: ${due - paid} ${currency}`;
    } else if (paid > due && due > 0) {
      const action=String(await getSetting(env.DB,'PAY_OVERPAYMENT_ACTION') || 'CREDIT').toUpperCase(); const surplus=paid-due;
      if(action==='CHANGE' || action==='REFUND'){ notes += ` | ${action==='CHANGE'?'Monnaie rendue':'Remboursement à émettre'}: ${surplus} ${currency}`; }
      else notes += ` | Avance créditée: +${surplus} ${currency}`;
    }
    const penaltyApplied = penaltyForPayment(conf, scheduleInfo, isTuition);
    if (penaltyApplied > 0) notes += ` | Pénalité de retard: ${penaltyApplied} ${currency}`;
    if (isTuition && scheduleInfo && scheduleInfo.expectedPerPeriod > 0) {
      const expectedPeriod = scheduleInfo.expectedPerPeriod;
      if (Math.abs(paid - expectedPeriod) > 0.01 && Math.abs(paid - scheduleInfo.fullOutstanding) > 0.01) {
        notes += ` | Versement attendu/période: ${expectedPeriod} ${currency}`;
      }
    }
    const receiptId = await generateReceiptId(env, orgId);
    const description = smartTuitionDescription(payload, scheduleInfo, conf, paid);
    const paymentDate = resolvePaymentDate(payload.paymentDate);
    const reference = String(payload.reference || payload.ref || payload.chequeNumber || payload.transferId || "").trim();
    const ts = nowIso();

    await env.DB.prepare(
      `INSERT INTO payments (id, org_id, history_id, student_id, student_name, description, amount,
         cashier_email, status, notes, payment_date, reference, client_request_id,
         created_at, version, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)`
    )
      .bind(
        receiptId,
        orgId,
        historyId,
        studentId,
        payload.studentName || null,
        description,
        finalAmt,
        viewer.email,
        status,
        notes,
        paymentDate,
        reference,
        clientReqId || null,
        ts,
        ts
      )
      .run();

    await writeAudit(env.DB, {
      table: "payments",
      rowId: receiptId,
      userId: viewer.userId,
      deviceId: payload.deviceId,
      op: "insert",
      diff: { studentId, paid, due, status },
    });

    return {
      success: true,
      receiptId,
      receiptNumber: receiptId,
      status,
      amountPaid: finalAmt,
      amountDue: reportedDue,
      currency,
      version: 1,
      paymentDate,
      cashierEmail: viewer.email,
      message: "Encaissement enregistré.",
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function findPayment(env, orgId, studentId, receiptId) {
  return env.DB.prepare(
    `SELECT * FROM payments WHERE org_id = ? AND student_id = ? AND id = ? AND deleted_at IS NULL`
  )
    .bind(orgId, studentId, receiptId)
    .first();
}

// {action: "voidPayment", data: {studentId, receiptId, reason, baseVersion?}}
// Never deletes the row — marks Status VOID, same convention
// _sumPaidThisYear_-style balance calcs already treat as excluded.
// Requires a reason: mutating a financial record after the fact without
// one explained is worse than no void feature at all.
export async function voidPayment(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await currentViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const payload = data || {};

    const studentId = String(payload.studentId || "").trim();
    const receiptId = String(payload.receiptId || "").trim();
    const reason = String(payload.reason || "").trim();
    if (!studentId || !receiptId) return { success: false, error: "studentId et receiptId requis." };
    if (!reason) return { success: false, error: "Un motif est requis pour annuler un paiement." };

    const found = await findPayment(env, orgId, studentId, receiptId);
    if (!found) return { success: false, error: "Paiement introuvable pour ce reçu/élève." };
    if (String(found.status).toUpperCase() === "VOID") {
      return { success: true, receiptId, status: "VOID", alreadyVoid: true, message: "Ce paiement était déjà annulé." };
    }
    if (payload.baseVersion !== undefined && Number(payload.baseVersion) !== Number(found.version)) {
      return { success: false, conflict: true, error: "Ce paiement a changé depuis votre dernière lecture." };
    }

    const timestamp = nowIso();
    const auditNote = ` | ANNULÉ par ${viewer.email || "inconnu"} le ${timestamp}: ${reason}`;
    const nextVersion = Number(found.version) + 1;

    await env.DB.prepare(
      `UPDATE payments SET status = 'VOID', notes = ?, version = ?, updated_at = ? WHERE id = ? AND org_id = ?`
    )
      .bind((found.notes || "") + auditNote, nextVersion, timestamp, receiptId, orgId)
      .run();

    await writeAudit(env.DB, {
      table: "payments",
      rowId: receiptId,
      userId: viewer.userId,
      deviceId: payload.deviceId,
      op: "void",
      diff: { previousStatus: found.status, reason, originalAmount: found.amount },
    });

    return { success: true, receiptId, status: "VOID", version: nextVersion, message: "Paiement annulé." };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "editPayment", data: {studentId, receiptId, reason, baseVersion?,
//   amountPaid?, paymentDate?, reference?, method?}}
// Only amount/date/reference/method-note are editable — studentId and
// description are not (that's really "wrong student/fee", a void + new
// payment, not a silent identity change on an existing receipt). Status
// (PAID/PARTIAL) is NOT recomputed automatically, same as Code.gs.
export async function editPayment(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const viewer = await currentViewer(env, auth);
    if (!viewer) return { success: false, error: "Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const payload = data || {};

    const studentId = String(payload.studentId || "").trim();
    const receiptId = String(payload.receiptId || "").trim();
    const reason = String(payload.reason || "").trim();
    if (!studentId || !receiptId) return { success: false, error: "studentId et receiptId requis." };
    if (!reason) return { success: false, error: "Un motif est requis pour modifier un paiement." };

    const found = await findPayment(env, orgId, studentId, receiptId);
    if (!found) return { success: false, error: "Paiement introuvable pour ce reçu/élève." };
    if (String(found.status).toUpperCase() === "VOID") {
      return { success: false, error: "Ce paiement est annulé — impossible de le modifier. Enregistrez un nouveau paiement à la place." };
    }
    if (payload.baseVersion !== undefined && Number(payload.baseVersion) !== Number(found.version)) {
      return { success: false, conflict: true, error: "Ce paiement a changé depuis votre dernière lecture." };
    }

    const before = { amount: found.amount, reference: found.reference, payment_date: found.payment_date };
    const hasNewAmount = payload.amountPaid !== undefined && payload.amountPaid !== null && payload.amountPaid !== "";
    const newAmount = hasNewAmount ? Number(payload.amountPaid) : before.amount;
    if (hasNewAmount && (!Number.isFinite(newAmount) || newAmount <= 0)) {
      return { success: false, error: "Montant invalide." };
    }

    const newDate = payload.paymentDate ? resolvePaymentDate(payload.paymentDate) : before.payment_date;
    const newReference = payload.reference !== undefined ? String(payload.reference).trim() : before.reference || "";
    const newMethod = payload.method !== undefined ? String(payload.method).trim() : "";

    const timestamp = nowIso();
    const changeParts = [];
    if (hasNewAmount && newAmount !== before.amount) changeParts.push(`montant ${before.amount}→${newAmount}`);
    if (payload.reference !== undefined && newReference !== String(before.reference || "").trim())
      changeParts.push(`référence "${before.reference || ""}"→"${newReference}"`);
    if (newMethod) changeParts.push(`méthode→${newMethod}`);
    const changeSummary = changeParts.length ? changeParts.join(", ") : "aucun changement de valeur";
    const auditNote = ` | MODIFIÉ par ${viewer.email || "inconnu"} le ${timestamp} (${changeSummary}): ${reason}`;
    const nextVersion = Number(found.version) + 1;

    await env.DB.prepare(
      `UPDATE payments SET amount = ?, notes = ?, payment_date = ?, reference = ?, version = ?, updated_at = ?
       WHERE id = ? AND org_id = ?`
    )
      .bind(newAmount, (found.notes || "") + auditNote, newDate, newReference, nextVersion, timestamp, receiptId, orgId)
      .run();

    await writeAudit(env.DB, {
      table: "payments",
      rowId: receiptId,
      userId: viewer.userId,
      deviceId: payload.deviceId,
      op: "edit",
      diff: { before, after: { amount: newAmount, date: newDate, reference: newReference, method: newMethod || undefined }, reason },
    });

    return {
      success: true,
      receiptId,
      amountPaid: newAmount,
      reference: newReference,
      paymentDate: newDate,
      version: nextVersion,
      message: "Paiement modifié.",
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


async function loadFinanceConfig(env){
  const {results}=await env.DB.prepare(`SELECT key,value FROM settings`).all();
  const c={};
  for(const r of results||[]){try{c[r.key]=JSON.parse(r.value);}catch{c[r.key]=r.value;}}
  return c;
}

async function expectedTuition(env,orgId,studentId){
  const c=await loadFinanceConfig(env);
  const info=await resolveExpectedTuition(env,orgId,studentId,c);
  return info.amount;
}

export async function getStudentFinanceProfile(data,auth,env){
  if(!auth?.token)return authError(); const sid=String(data?.studentId||data?.id||'').trim(); if(!sid)return {success:true,totalPaid:0,totalDue:0,totalDebt:0,transactions:[],payments:[]};
  const orgId=await resolveOrgId(env); const access=await assertStudentAccess(env,auth,orgId,sid); if(!access.allowed)return {success:false,error:access.error};
  const rows=(await env.DB.prepare(`SELECT * FROM payments WHERE org_id=? AND student_id=? AND deleted_at IS NULL ORDER BY payment_date DESC`).bind(orgId,sid).all()).results||[];
  const transactions=rows.map(paymentRowToApi); const totalPaid=rows.filter(r=>!['VOID','CANCELLED','ANNULE','REFUNDED'].includes(String(r.status).toUpperCase())).reduce((a,r)=>a+(Number(r.amount)||0),0); const totalDue=await expectedTuition(env,orgId,sid); const due=Math.max(totalDue,totalPaid); const totalDebt=Math.max(0,due-totalPaid);
  return {success:true,totalPaid,totalDue:due,totalDebt,outstanding:totalDebt,totalFees:due,balance:totalDebt,payments:transactions,transactions,financeConfigOk:totalDue>0,financeConfigWarning:totalDue>0?'':'Frais scolaires non configurés pour cet élève. Vérifiez la configuration Finance.'};
}
export async function getStudentFinanceSummary(data,auth,env){ return getStudentFinanceProfile(data,auth,env); }
export async function getPayments(data,auth,env){ return getStudentPayments(data,auth,env); }

// ── Groupe B — Paiement en ligne ────────────────────────────────────────────
// Real D1/R2 port of Code.gs's online_payment_requests queue.
// The request remains PENDING until an authorized reviewer approves/rejects it.

async function currentViewerFull(env, auth) {
  if (!auth?.token) return null;
  const v = await currentViewer(env, auth);
  if (!v) return null;
  const row = await env.DB.prepare(`SELECT id, user_id, email, name, role, is_master, is_god_mode, permissions_json
    FROM users WHERE deleted_at IS NULL AND (id=? OR user_id=? OR email=?)`).bind(v.userId, v.userId, v.email || '').first();
  if (!row) return null;
  let permissions = {};
  try { permissions = JSON.parse(row.permissions_json || '{}'); } catch {}
  return { ...v, id: row.id, userId: row.user_id || row.id, name: row.name || '', role: row.role || '',
    permissions, isMaster: Number(row.is_master) === 1, isGodMode: Number(row.is_god_mode) === 1 };
}

function canReviewOnlinePayments(viewer) {
  return !!viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_approve_payments || viewer.permissions?.pa_approve_payments || /admin|direction|finance|cashier/i.test(String(viewer.role || '')));
}

async function activeStudentSnapshot(env, orgId, studentId) {
  return env.DB.prepare(`SELECT s.student_code, s.first_name, s.last_name, s.current_level,
      h.history_id, h.grade_level_id
    FROM students s LEFT JOIN student_history h
      ON h.org_id=s.org_id AND h.student_id=s.student_code AND h.status='ACTIVE'
    WHERE s.org_id=? AND s.student_code=? AND s.deleted_at IS NULL
    ORDER BY h.updated_at DESC LIMIT 1`).bind(orgId, studentId).first();
}

async function uploadOnlineProof(env, orgId, studentId, data) {
  const proofBase64 = String(data?.proofBase64 || data?.proofFileBase64 || data?.proofFile || '').trim();
  const reference = String(data?.reference || '').trim();
  if (!proofBase64) {
    if (!reference) return { success:false, error:"Veuillez indiquer une référence de transaction ou joindre une preuve de paiement (photo/fichier)." };
    return { success:true, url:'', fileId:'', fileName:'' };
  }
  if (!env.MEDIA_BUCKET) return { success:false, error:"Stockage des preuves non configuré : ajoutez le binding R2 MEDIA_BUCKET." };
  const raw = proofBase64.includes(',') ? proofBase64.split(',')[1] : proofBase64;
  let bytes;
  try { bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0)); } catch { return { success:false, error:'Preuve de paiement invalide.' }; }
  if (bytes.byteLength > 10 * 1024 * 1024) return { success:false, error:'La preuve de paiement dépasse la limite de 10 Mo.' };
  const name = String(data?.proofFileName || `Preuve_${studentId}_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,160);
  const key = `${orgId}/payment-proofs/${Date.now()}-${crypto.randomUUID()}-${name}`;
  await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata:{ contentType:String(data?.proofMimeType || 'application/octet-stream') } });
  return { success:true, url:`/media/${encodeURIComponent(key)}`, fileId:key, fileName:name };
}

export async function submitOnlinePayment(data, auth, env) {
  try {
    const viewer = await currentViewerFull(env, auth);
    if (!viewer) return authError();
    const orgId = await resolveOrgId(env);
    const studentId = String(data?.studentId || data?.id || (String(viewer.role).toUpperCase()==='STUDENT' ? viewer.userId : '')).trim();
    if (!studentId) return { success:false, error:'Identifiant élève manquant.' };
    const guard = await assertStudentAccess(env, auth, orgId, studentId);
    if (!guard.allowed) return { success:false, error:guard.error };
    const amount = Number(data?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { success:false, error:'Montant invalide.' };
    const method = String(data?.method || 'MonCash').trim();
    const reference = String(data?.reference || '').trim();
    const note = String(data?.note || '').trim();
    const proof = await uploadOnlineProof(env, orgId, studentId, data || {});
    if (!proof.success) return proof;
    const student = await activeStudentSnapshot(env, orgId, studentId);
    if (!student) return { success:false, error:'Élève introuvable.' };
    const requestId = `OPR-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const ts = nowIso();
    await env.DB.prepare(`INSERT INTO online_payment_requests
      (id,org_id,student_id,student_name,history_id,grade_level_id,amount,method,reference,note,status,
       submitted_at,reviewed_by,reviewed_by_name,reviewed_at,review_note,receipt_id,
       proof_file_url,proof_file_name,proof_file_id,created_at,updated_at,version,deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?,NULL,NULL,NULL,NULL,NULL,?,?,?,?,?,1,NULL)`)
      .bind(requestId,orgId,studentId,`${student.first_name||''} ${student.last_name||''}`.trim(),student.history_id||'',student.grade_level_id||student.current_level||'',amount,method,reference,note,ts,proof.url,proof.fileName,proof.fileId,ts,ts).run();
    await writeAudit(env.DB,{table:'online_payment_requests',rowId:requestId,userId:viewer.id,op:'insert',diff:{studentId,amount,method,hasProof:!!proof.url}});
    return { success:true, requestId, proofUrl:proof.url, message:"Paiement soumis. En attente de validation par l'administration." };
  } catch(e) { return {success:false,error:e.message}; }
}

export async function getMyOnlinePaymentRequests(data, auth, env) {
  try {
    const viewer = await currentViewerFull(env, auth);
    if (!viewer) return authError();
    const orgId = await resolveOrgId(env);
    const studentId = String(data?.studentId || data?.id || (String(viewer.role).toUpperCase()==='STUDENT' ? viewer.userId : '')).trim();
    if (!studentId) return {success:false,error:'Identifiant élève manquant.'};
    const guard = await assertStudentAccess(env,auth,orgId,studentId);
    if(!guard.allowed) return {success:false,error:guard.error};
    const {results=[]}=await env.DB.prepare(`SELECT id,amount,method,reference,note,status,submitted_at,reviewed_at,review_note
      FROM online_payment_requests WHERE org_id=? AND student_id=? AND deleted_at IS NULL ORDER BY submitted_at DESC`).bind(orgId,studentId).all();
    return {success:true,items:results.map(r=>({requestId:r.id,amount:r.amount,method:r.method,reference:r.reference,note:r.note,status:r.status,submittedAt:r.submitted_at,reviewedAt:r.reviewed_at,reviewNote:r.review_note}))};
  } catch(e){return {success:false,error:e.message};}
}

export async function getPendingOnlinePayments(data, auth, env) {
  try {
    const viewer=await currentViewerFull(env,auth); if(!viewer)return authError();
    if(!canReviewOnlinePayments(viewer)) return {success:false,error:'Droits insuffisants.'};
    const {results=[]}=await env.DB.prepare(`SELECT id,student_id,student_name,amount,method,reference,note,submitted_at,proof_file_url,proof_file_name
      FROM online_payment_requests WHERE org_id=? AND status='PENDING' AND deleted_at IS NULL ORDER BY submitted_at ASC`).bind(await resolveOrgId(env)).all();
    return {success:true,items:results.map(r=>({requestId:r.id,studentId:r.student_id,studentName:r.student_name,amount:r.amount,method:r.method,reference:r.reference,note:r.note,submittedAt:r.submitted_at,proofUrl:r.proof_file_url,proofFileName:r.proof_file_name}))};
  } catch(e){return {success:false,error:e.message};}
}

export async function approveOnlinePayment(data, auth, env) {
  try {
    const viewer=await currentViewerFull(env,auth); if(!viewer)return authError();
    if(!canReviewOnlinePayments(viewer)) return {success:false,error:'Droits insuffisants.'};
    const requestId=String(data?.requestId||'').trim(); if(!requestId)return {success:false,error:'requestId manquant.'};
    const orgId=await resolveOrgId(env);
    const row=await env.DB.prepare(`SELECT * FROM online_payment_requests WHERE org_id=? AND id=? AND deleted_at IS NULL`).bind(orgId,requestId).first();
    if(!row)return {success:false,error:'Demande introuvable.'};
    if(String(row.status).toUpperCase()!=='PENDING')return {success:false,error:'Cette demande a déjà été traitée.'};
    const claim=await env.DB.prepare(`UPDATE online_payment_requests SET status='PROCESSING',updated_at=?,version=version+1 WHERE org_id=? AND id=? AND status='PENDING'`).bind(nowIso(),orgId,requestId).run();
    if(!claim.meta?.changes) return {success:false,error:'Cette demande a déjà été traitée.'};
    const paymentRes=await recordNewPayment({studentId:row.student_id,studentName:row.student_name,description:`Paiement en ligne (${row.method})${row.reference?' — Réf: '+row.reference:''}`,amountDue:row.amount,amountPaid:row.amount,method:'ONLINE',reference:row.reference},auth,env);
    if(!paymentRes?.success){await env.DB.prepare(`UPDATE online_payment_requests SET status='PENDING',updated_at=?,version=version+1 WHERE org_id=? AND id=?`).bind(nowIso(),orgId,requestId).run();return {success:false,error:paymentRes?.error||"Échec de l'enregistrement du paiement."};}
    const ts=nowIso();
    await env.DB.prepare(`UPDATE online_payment_requests SET status='APPROVED',reviewed_by=?,reviewed_by_name=?,reviewed_at=?,receipt_id=?,updated_at=?,version=version+1 WHERE org_id=? AND id=?`).bind(viewer.email||viewer.userId||'',viewer.name||'',ts,paymentRes.receiptId||'',ts,orgId,requestId).run();
    await writeAudit(env.DB,{table:'online_payment_requests',rowId:requestId,userId:viewer.id,op:'approve',diff:{studentId:row.student_id,amount:row.amount,receiptId:paymentRes.receiptId}});
    return {...paymentRes,requestId};
  }catch(e){return {success:false,error:e.message};}
}

export async function rejectOnlinePayment(data, auth, env) {
  try {
    const viewer=await currentViewerFull(env,auth); if(!viewer)return authError();
    if(!canReviewOnlinePayments(viewer)) return {success:false,error:'Droits insuffisants.'};
    const requestId=String(data?.requestId||'').trim(); if(!requestId)return {success:false,error:'requestId manquant.'};
    const orgId=await resolveOrgId(env);
    const row=await env.DB.prepare(`SELECT * FROM online_payment_requests WHERE org_id=? AND id=? AND deleted_at IS NULL`).bind(orgId,requestId).first();
    if(!row)return {success:false,error:'Demande introuvable.'};
    if(String(row.status).toUpperCase()!=='PENDING')return {success:false,error:'Cette demande a déjà été traitée.'};
    const ts=nowIso();
    await env.DB.prepare(`UPDATE online_payment_requests SET status='REJECTED',reviewed_by=?,reviewed_by_name=?,reviewed_at=?,review_note=?,updated_at=?,version=version+1 WHERE org_id=? AND id=? AND status='PENDING'`).bind(viewer.email||viewer.userId||'',viewer.name||'',ts,String(data?.note||'').trim(),ts,orgId,requestId).run();
    await writeAudit(env.DB,{table:'online_payment_requests',rowId:requestId,userId:viewer.id,op:'reject',diff:{studentId:row.student_id,reason:String(data?.note||'').trim()}});
    return {success:true,requestId};
  }catch(e){return {success:false,error:e.message};}
}

export async function verifyPaymentByClientRequestId(data, auth, env) {
  if(!auth?.token)return authError();
  const viewer=await currentViewerFull(env,auth);if(!viewer)return authError();
  const orgId=await resolveOrgId(env), studentId=String(data?.studentId||'').trim(), clientRequestId=String(data?.clientRequestId||'').trim();
  if(!studentId||!clientRequestId)return {success:true,found:false};
  const guard=await assertStudentAccess(env,auth,orgId,studentId);if(!guard.allowed)return {success:false,error:guard.error};
  const r=await env.DB.prepare(`SELECT id,amount,cashier_email,status,notes,payment_date FROM payments WHERE org_id=? AND student_id=? AND client_request_id=? AND deleted_at IS NULL LIMIT 1`).bind(orgId,studentId,clientRequestId).first();
  if(!r)return {success:true,found:false};
  return {success:true,found:true,receiptId:r.id,amount:Number(r.amount)||0,cashierEmail:r.cashier_email||'',cashierName:'',status:r.status||'',notes:r.notes||'',date:r.payment_date||''};
}
