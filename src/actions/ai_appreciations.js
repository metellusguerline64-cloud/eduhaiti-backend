import { getAiProviderKey } from "../lib/ai_key_store.js";
import { assertStudentAccess } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";

function periodOf(data) { return String(data?.periodId || data?.period || "").trim().toUpperCase(); }
function studentOf(data) { return String(data?.studentId || data?.studentCode || data?.studentID || "").trim(); }
function publicRow(row) {
  if (!row) return null;
  return { appreciationId: row.id, studentId: row.student_id, periodId: row.period_id, status: row.status, text: row.text, generatedAt: row.generated_at, updatedAt: row.updated_at, generatedBy: row.generated_by };
}

async function access(data, auth, env) {
  const studentId = studentOf(data);
  if (!studentId) return { error: "studentId requis." };
  const periodId = periodOf(data);
  if (!/^T[1-6]$/.test(periodId)) return { error: "Période invalide : attendu T1-T6." };
  const orgId = await resolveOrgId(env);
  const guard = await assertStudentAccess(env, auth, orgId, studentId);
  if (!guard.allowed) return { error: guard.error };
  return { orgId, studentId: guard.student.student_code, periodId, viewer: guard.viewer };
}

export async function getStudentAiAppreciation(data, auth, env) {
  try {
    const target = await access(data, auth, env);
    if (target.error) return { success: false, error: target.error };
    const row = await env.DB.prepare(`SELECT id,student_id,period_id,status,text,generated_at,updated_at,generated_by FROM ai_appreciations WHERE org_id=? AND student_id=? AND period_id=?`)
      .bind(target.orgId, target.studentId, target.periodId).first();
    return { success: true, exists: !!row, appreciation: publicRow(row) };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function saveStudentAiAppreciation(data, auth, env) {
  try {
    const target = await access(data, auth, env);
    if (target.error) return { success: false, error: target.error };
    const text = String(data?.text || "").trim();
    if (!text) return { success: false, error: "studentId, période et texte requis." };
    const row = await env.DB.prepare(`SELECT id,status FROM ai_appreciations WHERE org_id=? AND student_id=? AND period_id=?`)
      .bind(target.orgId, target.studentId, target.periodId).first();
    if (!row || row.status !== "GENERATED") return { success: false, error: "APPRECIATION_INTROUVABLE" };
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE ai_appreciations SET text=?,updated_at=?,generated_by=? WHERE id=?`)
      .bind(text.slice(0, 1200), updatedAt, target.viewer.email || target.viewer.id, row.id).run();
    return { success: true, text: text.slice(0, 1200), edited: true };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function generateStudentAiAppreciation(data, auth, env) {
  const viewer = auth?.token ? await import("../lib/accessScope.js").then(({ loadViewer }) => loadViewer(env, auth)) : null;
  if (!viewer) return { success: false, error: "SESSION_EXPIREE" };
  if (!(viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_manual || viewer.permissions?.pt_enter_grades || viewer.permissions?.pt_edit_grades)) {
    return { success: false, error: "PERMISSION_REFUSEE" };
  }
  const target = await access(data, auth, env);
  if (target.error) return { success: false, error: target.error };
  const criteria = Array.isArray(data?.criteria || data?.mentions) ? (data.criteria || data.mentions) : [];
  if (!criteria.length) return { success: false, error: "MENTIONS_REQUISES", missing: ["Aucun critère transmis."] };
  const missing = criteria.filter((item) => !item || !String(item.mention || item.value || "").trim()).map((item) => String(item?.label || item?.subjectId || item?.id || "critère"));
  if (missing.length) return { success: false, error: "MENTIONS_INCOMPLETES", missing };
  try {
    const existing = await env.DB.prepare(`SELECT id FROM ai_appreciations WHERE org_id=? AND student_id=? AND period_id=?`).bind(target.orgId, target.studentId, target.periodId).first();
    if (existing) return { success: false, error: "GENERATION_DEJA_EFFECTUEE", appreciationId: existing.id };
    const apiKey = await getAiProviderKey(env,"anthropic");
    if (!apiKey) return { success: false, error: "AI_PROVIDER_NOT_CONFIGURED" };
    const studentName = String(data?.studentName || data?.name || target.studentId).slice(0, 120);
    const prompt = `Rédige uniquement une appréciation scolaire personnalisée en français, professionnelle et bienveillante, en 1 à 2 phrases et 280 caractères maximum. Sans titre, sans markdown, sans formule introductive. Ne commence pas par le nom de l'élève et n'invente aucune note ni diagnostic. Élève: ${studentName}. Période: ${target.periodId}. Performances: ${JSON.stringify(criteria).slice(0, 10000)}`;
    const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 120, messages: [{ role: "user", content: prompt }] }) });
    if (!response.ok) return { success: false, error: `AI_PROVIDER_ERROR_${response.status}` };
    const body = await response.json();
    const text = String(body?.content?.find((part) => part.type === "text")?.text || "").trim().slice(0, 280);
    if (!text) return { success: false, error: "AI_EMPTY_RESPONSE" };
    const now = new Date().toISOString();
    const appreciationId = `APP-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(`INSERT INTO ai_appreciations(id,org_id,student_id,period_id,status,text,generated_at,updated_at,generated_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(appreciationId, target.orgId, target.studentId, target.periodId, "GENERATED", text, now, now, viewer.email || viewer.id).run();
    return { success: true, generated: true, text, appreciationId, freeService: true };
  } catch (error) { return { success: false, error: error.message }; }
}