// attendance.js — REAL port of Code.gs's attendance actions, verified
// with Code.gs in context. Real Sheet: 'attendance', headers
// RecordID/HistoryID/StudentID/GradeLevelID/Date/Status/RecordedBy/
// MetaJSON (Code.gs SHEET_DEFS). Ported functions:
//   - recordAttendance_        → recordAttendance        (Code.gs ~line 24021, kiosk IN/OUT)
//   - recordBulkAttendance_    → recordBulkAttendance     (Code.gs ~line 10087)
//   - recordStudentAttendance_ → recordStudentAttendance  (Code.gs ~line 10039, kiosk-by-fuzzy-term scan)
//   - verifyStudentByLast4_    → verifyStudentByLast4     (Code.gs ~line 8607, helper used by the above)
//   - getAttendanceForStudent_ → getAttendanceForStudent  (Code.gs ~line 10202)
//   - getStudentAttendance_    → getStudentAttendance     (Code.gs ~line 10281, thin alias)
//   - getAttendanceByDate_     → getAttendanceByDate      (Code.gs ~line 10235)
//   - getAttendanceStats_      → getAttendanceStats       (Code.gs ~line 10342)
//   - getStudentAttendanceStats_ → getStudentAttendanceStats (Code.gs ~line 10263)
//
// verifyStudentByLast4_ is a misnomer in the original too — despite the
// name, it's a substring match (`.includes(term)`) against StudentCode,
// FirstName, LastName, and NISU, not specifically "last 4 digits"; a
// kiosk just happens to usually be fed the last 4 digits of the code.
// D1 stores NISU in custom_fields JSON, so the lookup explicitly checks
// both common key spellings as well as the canonical student fields.
//
// Transport attendance is implemented below as a D1-native write path.
// Cache invalidation remains unnecessary because reads are live D1 queries.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { assertStudentAccess, loadViewer, canAccessStudent } from "../lib/accessScope.js";
import { loadSessionToken } from "../lib/session.js";

function authError() {
  return { success: false, error: "Non authentifié." };
}

async function currentUserId(env, auth) {
  if (!auth || !auth.token) return null;
  const session = await loadSessionToken(env.DB, auth.token);
  return session ? session.userId || session.email || null : null;
}

function normalizeStatusToken(raw) {
  const status = String(raw || "").trim().toUpperCase();
  if (status === "RETARD" || status === "LATE" || status === "R") return "LATE";
  if (status === "ABSENT" || status === "A") return "ABSENT";
  if (status === "PRESENT" || status === "P" || status === "ON_TIME" || status === "ONTIME") return "PRESENT";
  return status || "PRESENT";
}

function todayStr() {
  // Code.gs derives attendance dates from Session.getScriptTimeZone().
  // The school deployment is Haiti-local; using UTC here rolls the date
  // forward several hours before local midnight and can cause a false
  // duplicate/non-duplicate boundary around 20:00-23:59 local time.
  return staffLocalNow().date;
}

function safeParseJson(str) {
  if (str && typeof str === "object") return str;
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

async function activeHistoryFor(env, orgId, studentId) {
  return env.DB.prepare(
    `SELECT history_id, grade_level_id FROM student_history
     WHERE org_id = ? AND student_id = ? AND status = 'ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`
  )
    .bind(orgId, studentId)
    .first();
}

// Port of verifyStudentByLast4_: case-insensitive substring match
// against StudentCode/FirstName/LastName/NISU, first match wins (same
// "first row found" semantics as the original's array scan, ordered
// by insertion here via created_at rather than sheet row order — the
// two coincide for schools whose D1 data was seeded in the same order
// as the Sheet). NISU is stored in custom_fields JSON in D1 and is
// included explicitly in the lookup below for legacy kiosk parity.
async function verifyStudentByLast4(env, orgId, term) {
  const q = String(term || "").toLowerCase().trim();
  if (!q) return { found: false };
  const like = `%${q}%`;

  const row = await env.DB.prepare(
    `SELECT student_code, first_name, last_name, photo_url, current_level, custom_fields
     FROM students
     WHERE org_id = ? AND deleted_at IS NULL
       AND (LOWER(student_code) LIKE ? OR LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ? OR LOWER(COALESCE(json_extract(custom_fields,'$.NISU'),'')) LIKE ? OR LOWER(COALESCE(json_extract(custom_fields,'$.nisu'),'')) LIKE ?)
     ORDER BY created_at ASC
     LIMIT 1`
  )
    .bind(orgId, like, like, like, like, like)
    .first();

  if (!row) return { found: false };
  let cf={}; try { cf=JSON.parse(row.custom_fields||'{}'); } catch {}
  const nisu=cf.NISU ?? cf.nisu ?? cf.Nisu ?? cf.nisuNumber ?? '';
  return {
    found: true,
    student: {
      Student_ID: row.student_code,
      Student_Name: `${row.first_name || ""} ${row.last_name || ""}`.trim().toUpperCase(),
      Picture_URL: row.photo_url || "",
      CurrentLevel: row.current_level || "",
      NISU: nisu,
    },
  };
}

function rowToObj(r) {
  return {
    RecordID: r.id,
    HistoryID: r.history_id,
    StudentID: r.student_id,
    GradeLevelID: r.grade_level_id,
    Date: r.date,
    Status: r.status,
    RecordedBy: r.recorded_by,
    MetaJSON: safeParseJson(r.meta_json),
    UpdatedAt: r.updated_at,
  };
}

function staffLocalNow() {
  const tz = "America/Port-au-Prince";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  }).formatToParts(new Date());
  const get = k => parts.find(p => p.type === k)?.value || "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

async function staffViewer(env, auth) {
  if (!auth?.token) return null;
  return loadViewer(env, auth);
}

function isStaffAdmin(viewer) {
  return !!(viewer?.isMaster || viewer?.isGodMode || viewer?.permissions?.p_staff || viewer?.permissions?.p_hr_attendance);
}

function staffAttendanceRowToApi(r) {
  return {
    RecordID: r.id,
    StudentID: r.student_id,
    GradeLevelID: r.grade_level_id,
    Date: r.date,
    Status: r.status,
    RecordedBy: r.recorded_by,
    MetaJSON: safeParseJson(r.meta_json),
    UpdatedAt: r.updated_at,
  };
}

// Staff clocking is intentionally stored in the existing attendance table,
// exactly like Code.gs: GradeLevelID='STAFF', StudentID=email. A second scan
// for the same email/date closes the open punch by writing MetaJSON.checkOut.
export async function clockInStaff(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await staffViewer(env, auth);
    if (!viewer) return { success:false, error:"Session expirée ou token invalide." };
    const orgId = await resolveOrgId(env);
    const requestedEmail = String(data?.email || "").trim().toLowerCase();
    const email = requestedEmail || String(viewer.email || "").trim().toLowerCase();
    if (!email) return { success:false, error:"Email du collaborateur manquant." };
    if (!isStaffAdmin(viewer) && email !== String(viewer.email || "").trim().toLowerCase()) {
      return { success:false, error:"Accès refusé : vous ne pouvez pointer que votre propre présence." };
    }

    const now = staffLocalNow();
    const existing = await env.DB.prepare(
      `SELECT id, meta_json, status FROM attendance
       WHERE org_id=? AND LOWER(student_id)=LOWER(?) AND grade_level_id='STAFF' AND date=? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`
    ).bind(orgId,email,now.date).first();

    if (existing) {
      let meta = safeParseJson(existing.meta_json);
      meta.checkOut = now.time;
      meta.type = "STAFF";
      await env.DB.prepare(`UPDATE attendance SET meta_json=?,version=version+1,updated_at=? WHERE id=?`)
        .bind(JSON.stringify(meta),new Date().toISOString(),existing.id).run();
      await writeAudit(env.DB,{table:"attendance",rowId:existing.id,userId:viewer.id,op:"staff_exit",diff:{email,checkOut:now.time}});
      return {success:true,message:"Sortie validee: "+now.time,status:"CHECKED_OUT",date:now.date,time:now.time,id:existing.id};
    }

    const statusToken=String(data?.status||"PRESENT").trim().toUpperCase();
    const status=["PRESENT","LATE","ABSENT"].includes(statusToken)?statusToken:"PRESENT";
    const lateMinutes=Math.max(0,Number(data?.lateMinutes||0)||0);
    const meta={type:"STAFF",checkIn:now.time,status,lateMinutes,rawLateMinutes:Math.max(0,Number(data?.rawLateMinutes||lateMinutes)||lateMinutes),absentAfterMinutes:Math.max(1,Number(data?.absentAfterMinutes||120)||120),method:"STAFF"};
    const id="ATT-"+crypto.randomUUID().replace(/-/g,"").slice(0,8).toUpperCase();
    const ts=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO attendance(id,history_id,student_id,org_id,grade_level_id,date,status,recorded_by,meta_json,version,updated_at,deleted_at) VALUES(?,?,?,?,? ,?,?,?,?,1,?,NULL)`)
      .bind(id,null,email,orgId,"STAFF",now.date,status,email,JSON.stringify(meta),ts).run();
    await writeAudit(env.DB,{table:"attendance",rowId:id,userId:viewer.id,op:"staff_entry",diff:{email,checkIn:now.time,status,lateMinutes}});
    return {success:true,message:"Entree validee: "+now.time,status:"CHECKED_IN",date:now.date,time:now.time,id};
  } catch(e) {
    return {success:false,error:e.message};
  }
}

// Code.gs's getStaffAttendance_ delegates to getAttendanceForStudent_ with
// StudentID=email. D1 keeps that same contract but limits it to STAFF rows and
// prevents a teacher from reading another employee's attendance.
export async function getStaffAttendance(data, auth, env) {
  if (!auth?.token) return authError();
  const viewer=await staffViewer(env,auth);
  if(!viewer) return {success:false,error:"Session expirée ou token invalide."};
  const requested=String(data?.email||"").trim().toLowerCase();
  const email=requested||String(viewer.email||"").trim().toLowerCase();
  if(!email) return {success:false,error:"Email manquant."};
  if(!isStaffAdmin(viewer) && email!==String(viewer.email||"").trim().toLowerCase()) return {success:false,error:"Accès refusé."};
  const orgId=await resolveOrgId(env);
  const {results}=await env.DB.prepare(`SELECT id,student_id,grade_level_id,date,status,recorded_by,meta_json,updated_at FROM attendance WHERE org_id=? AND LOWER(student_id)=LOWER(?) AND grade_level_id='STAFF' AND deleted_at IS NULL ORDER BY date DESC, updated_at DESC`).bind(orgId,email).all();
  return {success:true,data:(results||[]).map(staffAttendanceRowToApi)};
}

// ?action=getAttendanceForStudent&studentId=...&historyId=...
export async function getAttendance(data, auth, env) {
  if(!auth?.token)return authError();
  const orgId=await resolveOrgId(env); const studentId=String(data?.studentId||data?.id||'').trim();
  if(studentId){const g=await assertStudentAccess(env,auth,orgId,studentId);if(!g.allowed)return {success:false,error:g.error};}
  const clauses=['org_id=?','deleted_at IS NULL'];const params=[orgId];
  if(studentId){clauses.push('student_id=?');params.push(studentId);}
  if(data?.date){clauses.push('date=?');params.push(String(data.date).slice(0,10));}
  const {results}=await env.DB.prepare(`SELECT id,history_id,student_id,grade_level_id,date,status,recorded_by,meta_json,updated_at FROM attendance WHERE ${clauses.join(' AND ')} ORDER BY date DESC, updated_at DESC`).bind(...params).all();
  return {success:true,data:(results||[]).map(rowToObj)};
}

export async function getAttendanceForStudent(data, auth, env) {
  const orgId = await resolveOrgId(env);
  const studentId = String((data && (data.studentId || data.id)) || "").trim();
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
    `SELECT id, history_id, student_id, grade_level_id, date, status, recorded_by, meta_json, updated_at
     FROM attendance WHERE ${clauses.join(" AND ")}
     ORDER BY date DESC`
  )
    .bind(...params)
    .all();

  return { success: true, data: (results || []).map(rowToObj) };
}

// {action: "getStudentAttendance", data: {studentId}} — thin alias,
// same as getStudentAttendance_ calling straight into getAttendanceForStudent_.
export async function getStudentAttendance(data, auth, env) {
  const sid = typeof data === "object" && data !== null ? data.studentId || data.id : data;
  if (!sid || sid === "undefined" || sid === "null") {
    return { success: false, error: "studentId manquant." };
  }
  return getAttendanceForStudent({ studentId: sid }, auth, env);
}

// ?action=getAttendanceByDate&date=YYYY-MM-DD
export async function getAttendanceByDate(data, auth, env) {
  const orgId = await resolveOrgId(env);
  const date = (data && data.date) || todayStr();

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.history_id, a.student_id, a.grade_level_id, a.date, a.status, a.recorded_by, a.meta_json, a.updated_at, s.current_level, s.section
     FROM attendance a LEFT JOIN students s ON s.org_id=a.org_id AND s.student_code=a.student_id AND s.deleted_at IS NULL
     WHERE a.org_id = ? AND a.date = ? AND a.deleted_at IS NULL
     ORDER BY a.updated_at DESC`
  )
    .bind(orgId, date)
    .all();

  const viewer=await loadViewer(env,auth);
  const scoped=viewer ? (results||[]).filter(r=>canAccessStudent(viewer,{StudentCode:r.student_id,CurrentLevel:r.current_level||r.grade_level_id,Section:r.section}).allowed) : (results||[]);
  return { success: true, data: scoped.map(rowToObj) };
}

// ?action=getAttendanceStats — global present/absent/late counts.
export async function getAttendanceStats(data, auth, env) {
  const orgId = await resolveOrgId(env);
  const { results } = await env.DB.prepare(
    `SELECT a.status,a.student_id,s.current_level,s.section FROM attendance a LEFT JOIN students s ON s.org_id=a.org_id AND s.student_code=a.student_id AND s.deleted_at IS NULL WHERE a.org_id = ? AND a.deleted_at IS NULL`
  )
    .bind(orgId)
    .all();

  const viewer=await loadViewer(env,auth);
  let present = 0,
    absent = 0,
    late = 0;
  for (const r of results || []) {
    if(viewer && !canAccessStudent(viewer,{StudentCode:r.student_id,CurrentLevel:r.current_level||"",Section:r.section}).allowed) continue;
    const s = normalizeStatusToken(r.status);
    if (s === "PRESENT") present++;
    else if (s === "ABSENT") absent++;
    else if (s === "LATE") late++;
  }
  return { success: true, data: { present, absent, late, total: present + absent + late } };
}

// {action: "getStudentAttendanceStats", data: {studentId}}
export async function getStudentAttendanceStats(data, auth, env) {
  const sid = typeof data === "object" && data !== null ? data.studentId || data.id : data;
  const result = await getAttendanceForStudent({ studentId: sid }, auth, env);
  if (!result.success) return { success: false, error: result.error };

  let present = 0,
    tardy = 0,
    absent = 0;
  for (const r of result.data) {
    const s = normalizeStatusToken(r.Status);
    if (s === "PRESENT") present++;
    else if (s === "LATE") tardy++;
    else if (s === "ABSENT") absent++;
  }
  const total = present + tardy + absent;
  const attendancePct = total > 0 ? Math.round(((present + tardy) / total) * 100) : 0;
  return { success: true, stats: { present, tardy, absent, total, attendancePct } };
}

// {action: "recordAttendance", data: {studentId, mode: "IN"|"OUT", time?}}
//
// Kiosk-style single check-in/out. Same duplicate rule as
// recordAttendance_: one row per student per day; a second scan the
// same day is reported as a duplicate rather than creating a second row.
export async function recordAttendance(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const obj = data || {};
    const studentId = String(obj.studentId || "").trim().toUpperCase();
    if (!studentId) return { success: false, error: "studentId manquant." };
    const access=auth ? await assertStudentAccess(env,auth,orgId,studentId) : {allowed:true}; if(!access.allowed) return {success:false,error:access.error};

    const date = todayStr();
    const existing = await env.DB.prepare(
      `SELECT id FROM attendance WHERE org_id = ? AND student_id = ? AND date = ? AND deleted_at IS NULL`
    )
      .bind(orgId, studentId, date)
      .first();
    if (existing) {
      return { success: false, duplicate: true, message: "Déjà pointé aujourd'hui." };
    }

    const hist = await activeHistoryFor(env, orgId, studentId);
    const status = String(obj.mode || "IN").toUpperCase() === "OUT" ? "SORTIE" : "PRESENT";
    const meta = { method: "KIOSK", mode: obj.mode || "IN", time: obj.time || "" };
    const id = "ATT-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const ts = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO attendance (id, history_id, student_id, org_id, grade_level_id, date, status,
         recorded_by, meta_json, version, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'KIOSK', ?, 1, ?, NULL)`
    )
      .bind(id, hist ? hist.history_id : null, studentId, orgId, hist ? hist.grade_level_id : obj.level || null, date, status, JSON.stringify(meta), ts)
      .run();

    await writeAudit(env.DB, {
      table: "attendance",
      rowId: id,
      userId: await currentUserId(env, auth),
      deviceId: obj.deviceId,
      op: "insert",
      diff: { studentId, mode: obj.mode || "IN" },
    });

    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// {action: "recordBulkAttendance", data: {records: [{id, status}, ...]}}
//
// Marks a whole class for today in one call. Per-record duplicate
// detection like recordBulkAttendance_'s `results` array — a bad
// record doesn't fail the rest of the batch.
export async function recordBulkAttendance(data, auth, env) {
  if (!auth || !auth.token) return authError();
  const orgId = await resolveOrgId(env);
  const userId = await currentUserId(env, auth);
  const date = todayStr();
  const inputRows = Array.isArray(data && data.records) ? data.records : Array.isArray(data) ? data : [];

  const { results: existingToday } = await env.DB.prepare(
    `SELECT student_id FROM attendance WHERE org_id = ? AND date = ? AND deleted_at IS NULL`
  )
    .bind(orgId, date)
    .all();
  const already = new Set((existingToday || []).map((r) => String(r.student_id).trim().toUpperCase()));

  const results = [];
  for (const rec of inputRows) {
    const sid = String((rec && rec.id) || "").trim().toUpperCase();
    if (!rec || (rec.type !== undefined && rec.type !== 'STUDENT')) {
      results.push({ id: sid, ok:false, success:false, reason:'INVALID_TYPE' });
      continue;
    }
    if (!sid) {
      results.push({ id: sid, ok:false, success:false, reason:'MISSING_ID' });
      continue;
    }
    const access=auth ? await assertStudentAccess(env,auth,orgId,sid) : {allowed:true};
    if(!access.allowed){ results.push({id:sid,ok:false,success:false,reason:'PERMISSION_DENIED',error:access.error}); continue; }
    if (already.has(sid)) {
      results.push({ id: sid, ok:false, success:false, alreadyScanned: true, reason: 'ALREADY_SCANNED' });
      continue;
    }

    try {
      const hist = await activeHistoryFor(env, orgId, sid);
      const status = String((rec && rec.status) || "PRESENT").toUpperCase();
      const attId = "ATT-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const ts = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO attendance (id, history_id, student_id, org_id, grade_level_id, date, status,
           recorded_by, meta_json, version, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, NULL)`
      )
        .bind(attId, hist ? hist.history_id : null, sid, orgId, hist ? hist.grade_level_id : null, date, status, userId || "System", ts)
        .run();

      await writeAudit(env.DB, { table: "attendance", rowId: attId, userId, deviceId: data.deviceId, op: "insert", diff: rec });
      already.add(sid);
      results.push({ id: sid, ok:true, success: true, reason:'RECORDED', recordId: attId });
    } catch (e) {
      results.push({ id: sid, ok:false, success: false, reason: e.message });
    }
  }

  return { success: true, processed: results.filter((r) => r.success).length, results };
}

// {action: "recordStudentAttendance", data: {shortCode|studentCode, status?, method?}}
//
// Real port of recordStudentAttendance_: `shortCode`/`studentCode` is
// looked up via verifyStudentByLast4 (fuzzy match, not an exact code),
// matching the kiosk workflow where a student types the last few
// digits of their code rather than the whole thing.
export async function recordTransportAttendance(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const orgId=await resolveOrgId(env);
    const studentId=String(data?.studentId||data?.studentCode||'').trim();
    if(!studentId)return {success:false,error:'studentId manquant.'};
    const access=await assertStudentAccess(env,auth,orgId,studentId); if(!access.allowed)return {success:false,error:access.error};
    const hist=await activeHistoryFor(env,orgId,studentId);
    const date=String(data?.date||todayStr()).slice(0,10), ts=new Date().toISOString();
    const status=normalizeStatusToken(data?.status||'PRESENT');
    const meta={method:'TRANSPORT',mode:String(data?.mode||'IN').toUpperCase(),time:ts.slice(11,19),route:data?.route||'',vehicle:data?.vehicle||''};
    const id='ATT-'+crypto.randomUUID().replace(/-/g,'').slice(0,8);
    await env.DB.prepare(`INSERT INTO attendance(id,history_id,student_id,org_id,grade_level_id,date,status,recorded_by,meta_json,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,NULL)`).bind(id,hist?.history_id||null,studentId,orgId,hist?.grade_level_id||null,date,status,(await currentUserId(env,auth))||'KIOSK',JSON.stringify(meta),ts).run();
    await writeAudit(env.DB,{table:'attendance',rowId:id,userId:await currentUserId(env,auth),deviceId:data?.deviceId,op:'transport',diff:{studentId,date,status}});
    return {success:true,id,studentId,status,date,method:'TRANSPORT'};
  }catch(e){return {success:false,error:e.message};}
}

export async function recordStudentAttendance(data, auth, env) {
  if (!auth || !auth.token) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const obj = data || {};
    const term = String(obj.shortCode || obj.studentCode || "").trim();
    if (!term) return { success: false, error: "studentCode manquant." };

    const veri = await verifyStudentByLast4(env, orgId, term);
    if (!veri.found) return { success: false, error: `Aucun eleve pour: ${term}` };
    const studentId = veri.student.Student_ID;
    const access=auth ? await assertStudentAccess(env,auth,orgId,studentId) : {allowed:true}; if(!access.allowed) return {success:false,error:access.error};
    const name = veri.student.Student_Name;

    const date = todayStr();
    const existing = await env.DB.prepare(
      `SELECT id FROM attendance WHERE org_id = ? AND student_id = ? AND date = ? AND deleted_at IS NULL`
    )
      .bind(orgId, studentId, date)
      .first();
    if (existing) {
      return { success: false, alreadyScanned: true, studentName: name, message: `${name} déjà pointé aujourd'hui.` };
    }

    const hist = await activeHistoryFor(env, orgId, studentId);
    const id = "ATT-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const ts = new Date().toISOString();
    const meta = { method: obj.method || "KIOSK", time: ts.slice(11, 19) };

    await env.DB.prepare(
      `INSERT INTO attendance (id, history_id, student_id, org_id, grade_level_id, date, status,
         recorded_by, meta_json, version, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'KIOSK', ?, 1, ?, NULL)`
    )
      .bind(id, hist ? hist.history_id : null, studentId, orgId, hist ? hist.grade_level_id : null, date, obj.status || "PRESENT", JSON.stringify(meta), ts)
      .run();

    await writeAudit(env.DB, {
      table: "attendance",
      rowId: id,
      userId: await currentUserId(env, auth),
      deviceId: obj.deviceId,
      op: "insert",
      diff: { studentId, status: obj.status || "PRESENT" },
    });

    return { success: true, studentName: name, studentId, time: meta.time, message: `Présence confirmée pour ${name}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
