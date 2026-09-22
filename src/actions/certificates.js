// EduHaïti — Certificates / attestations + public verification.
// This is a Cloudflare-native enhancement: the supplied Code.gs contains
// bulletin authenticity verification, but no complete certificate registry.
// The certificate registry therefore follows the same public-verification
// principle without pretending to be a verbatim Code.gs port.

import { resolveOrgId } from "../lib/org.js";
import { assertStudentAccess } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

const clean = (v) => String(v ?? "").trim();
const now = () => new Date().toISOString();
const safeJson = (v, fallback = {}) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "")); } catch { return fallback; } };
const esc = (v) => clean(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const token = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();

async function schoolSettings(env) {
  const { results } = await env.DB.prepare(`SELECT key,value FROM settings`).all();
  const out = {};
  for (const r of results || []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

async function student(env, orgId, sid) {
  return env.DB.prepare(`SELECT * FROM students WHERE org_id=? AND student_code=? AND deleted_at IS NULL`).bind(orgId, sid).first();
}

function certificateNumber(prefix = "CERT") {
  const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${clean(prefix).toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "CERT"}-${stamp}-${rand}`;
}

export async function issueCertificate(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const orgId = await resolveOrgId(env);
  const sid = clean(data?.studentId);
  if (!sid) return { success:false, error:"Matricule manquant." };
  const guard = await assertStudentAccess(env, auth, orgId, sid);
  if (!guard.allowed) return { success:false, error:guard.error };

  const s = await student(env, orgId, sid);
  if (!s) return { success:false, error:"Élève introuvable." };
  const settings = await schoolSettings(env);
  const issuedAt = clean(data.issueDate) || now().slice(0,10);
  const certificateNo = clean(data.certificateNo) || certificateNumber(data.prefix || "CERT");
  const verifyToken = token();
  const meta = safeJson(data.metadata, {});
  if (data.average != null) meta.average = Number(data.average);
  if (data.decision) meta.decision = clean(data.decision);

  const id = `CERT-${crypto.randomUUID()}`;
  const ts = now();
  await env.DB.prepare(`INSERT INTO certificates
    (id,certificate_no,student_id,student_name,certificate_type,title,description,school_year,cycle,class_name,issue_date,issued_by,status,verification_token,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, certificateNo, sid, `${clean(s.first_name)} ${clean(s.last_name)}`.trim() || sid,
      clean(data.certificateType) || "CERTIFICAT_SCOLAIRE",
      clean(data.title) || "Certificat scolaire",
      clean(data.description),
      clean(data.schoolYear) || clean(settings.ACADEMIC_YEAR) || "",
      clean(data.cycle) || clean(s.current_level),
      clean(data.className) || clean(s.current_level),
      issuedAt,
      clean(auth.email || auth.userId || ""),
      "ISSUED", verifyToken, JSON.stringify(meta), ts, ts).run();

  await writeAudit(env.DB, { table:"certificates", rowId:id, userId:auth.email || auth.userId || "", op:"ISSUE", diff:{ studentId:sid, certificateNo } });
  return { success:true, certificate:{ id, certificateNo, verificationToken:verifyToken, studentId:sid, studentName:`${clean(s.first_name)} ${clean(s.last_name)}`.trim() || sid, status:"ISSUED", issueDate:issuedAt } };
}

export async function listCertificates(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const orgId = await resolveOrgId(env);
  const sid = clean(data?.studentId);
  if (sid) {
    const guard = await assertStudentAccess(env, auth, orgId, sid);
    if (!guard.allowed) return { success:false, error:guard.error };
  }
  let sql = `SELECT id,certificate_no AS certificateNo,student_id AS studentId,student_name AS studentName,certificate_type AS certificateType,title,school_year AS schoolYear,cycle,class_name AS className,issue_date AS issueDate,issued_by AS issuedBy,status,verification_token AS verificationToken,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt FROM certificates WHERE deleted_at IS NULL`;
  const params = [];
  if (sid) { sql += ` AND student_id=?`; params.push(sid); }
  if (clean(data?.status)) { sql += ` AND status=?`; params.push(clean(data.status).toUpperCase()); }
  sql += ` ORDER BY issue_date DESC, created_at DESC LIMIT ?`; params.push(Math.min(500, Math.max(1, Number(data?.limit) || 100)));
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return { success:true, rows:(results||[]).map(r=>({ ...r, metadata:safeJson(r.metadataJson,{}) })) };
}

export async function getCertificate(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const orgId = await resolveOrgId(env);
  const id = clean(data?.id || data?.certificateId);
  const row = await env.DB.prepare(`SELECT * FROM certificates WHERE id=? AND deleted_at IS NULL`).bind(id).first();
  if (!row) return { success:false, error:"Certificat introuvable." };
  const guard = await assertStudentAccess(env, auth, orgId, row.student_id);
  if (!guard.allowed) return { success:false, error:guard.error };
  return { success:true, certificate:{...row, metadata:safeJson(row.metadata_json,{})} };
}

export async function revokeCertificate(data, auth, env) {
  if (!auth?.token) return { success:false, error:"Non authentifié." };
  const id = clean(data?.id || data?.certificateId);
  if (!id) return { success:false, error:"Identifiant du certificat manquant." };
  const row = await env.DB.prepare(`SELECT id,student_id,certificate_no FROM certificates WHERE id=? AND deleted_at IS NULL`).bind(id).first();
  if (!row) return { success:false, error:"Certificat introuvable." };
  const orgId = await resolveOrgId(env);
  const guard = await assertStudentAccess(env, auth, orgId, row.student_id);
  if (!guard.allowed) return { success:false, error:guard.error };
  const ts = now();
  await env.DB.prepare(`UPDATE certificates SET status='REVOKED',deleted_at=?,updated_at=?,version=version+1 WHERE id=?`).bind(ts,ts,id).run();
  await writeAudit(env.DB,{table:"certificates",rowId:id,userId:auth.email||auth.userId||"",op:"REVOKE",diff:{certificateNo:row.certificate_no}});
  return { success:true, message:"Certificat révoqué." };
}

export async function verifyCertificate(data, _auth, env) {
  const key = clean(typeof data === "string" ? data : data?.verificationToken || data?.token || data?.certificateNo || data?.id);
  if (!key) return { success:false, verified:false, error:"Code de vérification requis." };
  const row = await env.DB.prepare(`SELECT certificate_no AS certificateNo,student_id AS studentId,student_name AS studentName,certificate_type AS certificateType,title,school_year AS schoolYear,cycle,class_name AS className,issue_date AS issueDate,status,verification_token AS verificationToken,metadata_json AS metadataJson FROM certificates WHERE deleted_at IS NULL AND (verification_token=? OR certificate_no=? OR id=?)`).bind(key,key,key).first();
  if (!row) return { success:true, verified:false, verificationToken:key };
  return { success:true, verified:row.status === "ISSUED", verificationToken:row.verificationToken, certificate:{ certificateNo:row.certificateNo,studentId:row.studentId,studentName:row.studentName,certificateType:row.certificateType,title:row.title,schoolYear:row.schoolYear,cycle:row.cycle,className:row.className,issueDate:row.issueDate,status:row.status,metadata:safeJson(row.metadataJson,{}) } };
}

export async function getCertificatePrintHtml(data, auth, env) {
  if (!auth?.token) return { success:false,error:"Non authentifié." };
  const got = await getCertificate(data,auth,env);
  if (!got.success) return got;
  const settings = await schoolSettings(env);
  const c = got.certificate;
  const schoolName = clean(settings.SCHOOL_NAME || settings.schoolName) || "Établissement scolaire";
  const logo = clean(settings.SCHOOL_LOGO || settings.schoolLogo);
  const verifyUrl = clean(data?.verifyUrl) || `/verify/certificate/${encodeURIComponent(c.verification_token)}`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} — ${esc(c.student_name)}</title><style>@page{size:A4 portrait;margin:18mm}body{font-family:Georgia,'Times New Roman',serif;background:#fff;color:#172033;margin:0}.page{min-height:250mm;border:2px solid #183b73;padding:18mm;box-sizing:border-box;text-align:center}.logo{max-height:90px;max-width:180px;object-fit:contain}.school{font:700 24px Arial,sans-serif;text-transform:uppercase;margin:12px 0;color:#183b73}.label{font:600 13px Arial,sans-serif;letter-spacing:2px}.title{font-size:34px;margin:34px 0 20px}.student{font-size:28px;font-weight:700;margin:20px 0;color:#183b73}.desc{font-size:18px;line-height:1.7;max-width:680px;margin:0 auto}.meta{margin:30px auto;display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:650px;font:14px Arial,sans-serif}.verify{margin-top:35px;font:12px Arial,sans-serif;color:#536176}.sign{margin-top:55px;display:flex;justify-content:space-around;font:13px Arial,sans-serif}.line{width:220px;border-top:1px solid #333;padding-top:8px}</style></head><body><main class="page">${logo?`<img class="logo" src="${esc(logo)}">`:''}<div class="school">${esc(schoolName)}</div><div class="label">DOCUMENT OFFICIEL</div><h1 class="title">${esc(c.title)}</h1><div class="student">${esc(c.student_name)}</div><p class="desc">${esc(c.description || 'Le présent certificat est délivré à la personne désignée ci-dessus pour servir et valoir ce que de droit.')}</p><div class="meta"><div><b>Année scolaire</b><br>${esc(c.school_year)}</div><div><b>Classe / Niveau</b><br>${esc(c.class_name || c.cycle)}</div><div><b>Date de délivrance</b><br>${esc(c.issue_date)}</div><div><b>N° certificat</b><br>${esc(c.certificate_no)}</div></div><div class="sign"><div class="line">Direction</div><div class="line">Signature autorisée</div></div><div class="verify">Vérification : ${esc(verifyUrl)}<br>Code : ${esc(c.verification_token)}</div></main></body></html>`;
  return { success:true, html, fileName:`${c.certificate_no}.html`, mimeType:"text/html" };
}
