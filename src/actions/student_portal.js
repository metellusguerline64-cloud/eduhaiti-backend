import { resolveOrgId } from "../lib/org.js";
import { hashPin } from "../lib/hash.js";
import { storeSessionToken, loadSessionToken } from "../lib/session.js";

const now = () => new Date().toISOString();
const clean = v => String(v ?? "").trim();
const digits = v => clean(v).replace(/\D/g, "");
const norm = v => clean(v).replace(/\s+/g, "").toUpperCase();

function codeCandidates(input, prefix) {
  const raw = clean(input), out = new Set();
  if (!raw) return out;
  const add = v => { if (v) { out.add(norm(v)); out.add(clean(v)); } };
  add(raw);
  const d = digits(raw);
  if (d) { add(d); add(prefix + d); add(prefix + d.padStart(4, "0")); }
  if (norm(raw).startsWith(norm(prefix))) add(raw.slice(clean(prefix).length));
  return out;
}

function idMatches(value, input, prefix) {
  const a = norm(value), b = norm(input);
  if (!a || !b) return false;
  if (a === b || codeCandidates(input, prefix).has(a)) return true;
  const ad = digits(a), bd = digits(b);
  return !!(ad && bd && (ad.endsWith(bd) || bd.endsWith(ad)));
}

async function findStudent(env, orgId, input) {
  const prefix = String((await env.DB.prepare(`SELECT value FROM settings WHERE key IN ('STUDENT_ID_PREFIX','SYSTEM_ID_PREFIX') ORDER BY CASE key WHEN 'STUDENT_ID_PREFIX' THEN 0 ELSE 1 END LIMIT 1`).first())?.value || "MT").toUpperCase();
  const { results } = await env.DB.prepare(`SELECT * FROM students WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all();
  return (results || []).find(r => idMatches(r.student_code, input, prefix) || idMatches(r.id, input, prefix)) || null;
}

export async function studentPortalLogin(data, _auth, env) {
  try {
    const orgId = await resolveOrgId(env);
    const inputCode = clean(data?.studentCode || data?.code || data?.fullId || data?.id);
    const secret = clean(data?.pin || data?.secret || data?.parentPhone || data?.password);
    if (!inputCode || !secret) return { success:false, message:'Identifiants incorrects.' };
    const student = await findStudent(env, orgId, inputCode);
    if (!student) return { success:false, message:'Code élève introuvable.' };
    if (Number(student.active) === 0) return { success:false, message:'Compte élève suspendu. Contactez l’école.' };

    const storedPin = clean(student.pin_hash);
    if (storedPin) {
      const incomingHash = await hashPin(secret);
      if (incomingHash !== storedPin && secret !== storedPin) return { success:false, message:'Identifiants incorrects.' };
      const token = crypto.randomUUID();
      await storeSessionToken(env.DB, token, { role:'STUDENT', studentCode:student.student_code, studentId:student.student_code, orgId }, 21600);
      await env.DB.prepare(`UPDATE students SET updated_at=? WHERE org_id=? AND student_code=?`).bind(now(),orgId,student.student_code).run();
      return { success:true, firstTime:false, token, studentCode:student.student_code };
    }

    const inputPhone = digits(secret);
    let cf = {}; try { cf = JSON.parse(student.custom_fields || '{}'); } catch {}
    const phones = [digits(cf.parentPhone || cf.ParentPhone || cf.parent_phone), digits(cf.phone2 || cf.Phone2 || cf.parentPhone2), digits(student.phone)].filter(Boolean);
    const phoneMatches = phones.some(p => inputPhone === p || inputPhone === p.slice(-8));
    if (!phoneMatches) return { success:false, message:'Identifiants incorrects.' };
    return { success:true, firstTime:true, studentCode:student.student_code };
  } catch (e) {
    return { success:false, message:'Erreur serveur : '+e.message };
  }
}

export async function setupInitialPin(data, _auth, env) {
  try {
    const studentId = clean(data?.fullId || data?.id || data?.studentCode || data?.studentId);
    const pin = clean(data?.newPin || data?.pin);
    if (!studentId) return { success:false, error:'Identifiant élève requis.' };
    if (pin.length < 4) return { success:false, error:'PIN trop court (minimum 4 chiffres).' };
    const orgId = await resolveOrgId(env);
    const student = await findStudent(env, orgId, studentId);
    if (!student) return { success:false, error:'Identifiant introuvable.' };
    const token = crypto.randomUUID();
    await env.DB.prepare(`UPDATE students SET pin_hash=?, updated_at=?, version=version+1 WHERE org_id=? AND student_code=? AND deleted_at IS NULL`).bind(await hashPin(pin),now(),orgId,student.student_code).run();
    await storeSessionToken(env.DB, token, { role:'STUDENT', studentCode:student.student_code, studentId:student.student_code, orgId }, 21600);
    return { success:true, token };
  } catch(e) { return { success:false, error:e.message }; }
}

export async function getActiveEnrollment(data, auth, env) {
  try {
    const orgId = await resolveOrgId(env), sid = clean(data?.studentId || data?.id || data?.studentCode);
    if (!sid) return { success:false, error:'studentId manquant.' };
    const s = auth?.token ? await loadSessionToken(env.DB, auth.token) : null;
    const student = await findStudent(env, orgId, sid);
    if (!student) return { success:true, data:null };
    if (s?.role === 'STUDENT' && s.studentCode !== student.student_code) return { success:false,error:'Accès refusé.' };
    const r = await env.DB.prepare(`SELECT history_id,school_year,grade_level_id,section,status FROM student_history WHERE org_id=? AND student_id=? ORDER BY updated_at DESC LIMIT 1`).bind(orgId,student.student_code).first();
    if (!r || String(r.status).toUpperCase() !== 'ACTIVE') return { success:true,data:null };
    return { success:true,data:{historyId:r.history_id,schoolYear:r.school_year,gradeLevel:r.grade_level_id,section:r.section,status:r.status} };
  } catch(e) { return { success:false,error:e.message }; }
}

export async function getEnrollmentsByClass(data, auth, env) {
  try {
    const classId = clean(data?.classId || data?.class || data?.level || data?.niveau);
    if (!classId) return { success:false,error:'Paramètre classId requis.' };
    const orgId = await resolveOrgId(env);
    const { results } = await env.DB.prepare(`SELECT s.*,h.history_id,h.grade_level_id,h.section AS history_section,h.school_year,h.status AS history_status FROM students s LEFT JOIN (SELECT *,ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY updated_at DESC) rn FROM student_history WHERE org_id=?) h ON h.student_id=s.student_code AND h.rn=1 WHERE s.org_id=? AND s.deleted_at IS NULL ORDER BY s.last_name,s.first_name`).bind(orgId,orgId).all();
    const needle = norm(classId);
    const dataOut = (results||[]).filter(r => norm(r.grade_level_id || r.current_level) === needle && String(r.history_status||'ACTIVE').toUpperCase() === 'ACTIVE').map(r => ({ StudentCode:r.student_code, StudentID:r.student_code, id:r.student_code, studentId:r.student_code, FirstName:r.first_name, LastName:r.last_name, level:r.grade_level_id||r.current_level||'', classe:r.grade_level_id||r.current_level||'', classId:r.grade_level_id||r.current_level||'', Section:r.history_section||r.section||'', SchoolYear:r.school_year||'', Active:'TRUE' }));
    return { success:true,data:dataOut,count:dataOut.length };
  } catch(e) { return { success:false,error:'getEnrollmentsByClass_ erreur: '+e.message }; }
}

export async function verifyStudentByLast4(data, _auth, env) {
  try {
    const term = clean(typeof data === 'string' ? data : (data?.query || data?.term || data?.search));
    if (!term) return { found:false };
    const orgId = await resolveOrgId(env);
    const { results } = await env.DB.prepare(`SELECT student_code,first_name,last_name,photo_url,current_level,custom_fields FROM students WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all();
    const t = term.toLowerCase();
    for (const r of results||[]) {
      let cf={}; try { cf=JSON.parse(r.custom_fields||'{}'); } catch {}
      const nisu=clean(cf.NISU || cf.nisu || cf.NISUCode);
      if ([r.student_code,r.first_name,r.last_name,nisu].some(v=>clean(v).toLowerCase().includes(t))) return { found:true,student:{Student_ID:r.student_code,Student_Name:`${r.first_name||''} ${r.last_name||''}`.trim().toUpperCase(),Picture_URL:r.photo_url||'',CurrentLevel:r.current_level||''} };
    }
    return { found:false };
  } catch(e) { return { found:false,error:e.message }; }
}
