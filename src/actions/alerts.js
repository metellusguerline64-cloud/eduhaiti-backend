// alerts.js — HR / dashboard alerts ported from Code.gs.
// Ports:
//   getSystemAlerts_              -> getSystemAlerts
//   confirmTeacherAlertStatus_    -> confirmTeacherAlertStatus
//   notifyLateStaff_              -> notifyLateStaff
//
// Notifications are application-only in the Worker. There is no email delivery
// path: important events are persisted in D1 and surfaced by getNotifications.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { loadViewer } from "../lib/accessScope.js";
import { getSetting } from "../lib/settings.js";

function authError() { return { success: false, error: "Session invalide." }; }

function can(viewer, ...keys) {
  if (!viewer) return false;
  if (viewer.isMaster || viewer.isGodMode) return true;
  const p = viewer.permissions || {};
  return keys.some(k => !!p[k]);
}

function canSeeCategory(viewer, category) {
  const cat = String(category || "").toUpperCase();
  if (viewer?.isMaster || viewer?.isGodMode) return true;
  if (cat === "STAFF") return can(viewer, "p_staff", "p_hr_attendance", "pa_teacher_affectation");
  if (cat === "ATTENDANCE") return can(viewer, "p_attendance", "p_hr_attendance");
  if (cat === "ACADEMIC") return can(viewer, "p_grades", "p_dossier");
  if (cat === "FINANCE") return can(viewer, "p_finance");
  if (cat === "CONFIG") return can(viewer, "p_settings", "pa_save_settings");
  if (cat === "PARENT_REQUESTS") return can(viewer, "pa_add_student", "pa_edit_student", "p_staff");
  return true;
}

async function settingsMap(db) {
  const { results } = await db.prepare(`SELECT key,value FROM settings`).all();
  const out = {};
  for (const r of results || []) {
    let v = r.value;
    if (typeof v === "string") {
      const s = v.trim();
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try { v = JSON.parse(s); } catch {}
      }
    }
    out[r.key] = v;
  }
  return out;
}

function localNow() {
  const tz = "America/Port-au-Prince";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  }).formatToParts(new Date());
  const get = k => parts.find(p => p.type === k)?.value || "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour").padStart(2,"0")}:${get("minute").padStart(2,"0")}:${get("second").padStart(2,"0")}`;
  return { date, time, hour:Number(get("hour")), minute:Number(get("minute")) };
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function listSetting(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean);
}

function isSchoolDay(conf, now) {
  const dow = new Date(`${now.date}T12:00:00`).getDay();
  const autoWeekend = String(conf.NO_CLASS_WEEKDAYS_AUTO ?? "1") !== "0";
  if (autoWeekend && (dow === 0 || dow === 6)) return false;
  const fr = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
  const todayFr = fr[dow];
  const weekdays = listSetting(conf.NO_CLASS_WEEKDAYS).map(x => String(x).toLowerCase());
  if (weekdays.some(x => x === todayFr || x.startsWith(todayFr.slice(0,3)))) return false;
  const dates = listSetting(conf.NO_CLASS_DATES).map(x => x.slice(0,10));
  const rules = parseJson(conf.NO_CLASS_RULES_JSON, []);
  if (dates.includes(now.date)) return false;
  if (Array.isArray(rules) && rules.some(r => String(r?.date || "").slice(0,10) === now.date)) return false;
  return true;
}

function dayName(date) {
  const d = new Date(`${date}T12:00:00`).getDay();
  return ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"][d];
}

function timeToMinutes(v) {
  const m = String(v || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function levelDisplay(id) {
  const map = {
    mat_k1:"K1", mat_k2:"K2", mat_k3:"K3",
    fond_1af:"1re AF", fond_2af:"2me AF", fond_3af:"3me AF", fond_4af:"4me AF",
    fond_5af:"5me AF", fond_6af:"6me AF", fond_7af:"7me AF", fond_8af:"8me AF", fond_9af:"9me AF",
    sec_ns1:"NS1", sec_ns2:"NS2", sec_ns3:"NS3", sec_ns4:"NS4",
    sec_rheto:"Rhéto", sec_philo:"Philo", sec_term:"Terminale"
  };
  const k = String(id || "").trim().toLowerCase();
  return map[k] || String(id || "");
}

async function getUsers(db) {
  const { results } = await db.prepare(`SELECT id,user_id,email,name,role,permissions_json,is_master,is_god_mode,active FROM users WHERE deleted_at IS NULL`).all();
  return results || [];
}

function userEmailForTeacher(users, teacherName) {
  const needle = String(teacherName || "").trim().toLowerCase();
  const u = users.find(x => String(x.name || "").trim().toLowerCase() === needle);
  return u ? String(u.email || "").trim().toLowerCase() : "";
}

export async function getSystemAlerts(_data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();
    const orgId = await resolveOrgId(env);
    const conf = await settingsMap(env.DB);
    const now = localNow();
    const schoolHours = now.hour >= 7 && now.hour <= 17;
    const schoolDay = isSchoolDay(conf, now);
    const alerts = [];

    // 1. Classes without an active teacher assignment.
    let classes = [];
    const activeLevels = parseJson(conf.ACTIVE_LEVELS, []);
    if (Array.isArray(activeLevels)) classes.push(...activeLevels.map(x => String(x?.id || x?.label || x || "").trim()).filter(Boolean));
    const classRows = await env.DB.prepare(`SELECT fields FROM classes WHERE deleted_at IS NULL`).all();
    for (const r of classRows.results || []) {
      const f = parseJson(r.fields, {});
      const cls = String(f.className || f.name || f.class || f.gradeLevelId || f.GradeLevelID || "").trim();
      if (cls && !classes.includes(cls)) classes.push(cls);
    }
    const { results: assignments } = await env.DB.prepare(`SELECT teacher_name,class_name,day,start_time,active FROM teacher_assignments WHERE org_id=? AND deleted_at IS NULL`).bind(orgId).all();
    const activeAssignments = (assignments || []).filter(a => String(a.active ?? 1).toUpperCase() !== "FALSE" && Number(a.active ?? 1) !== 0);
    if (schoolDay) {
      for (const cls of classes) {
        if (!activeAssignments.some(a => String(a.class_name || "").trim() === cls)) {
          alerts.push({ id:`no-teacher-${cls}`, type:"WARNING", severity:"HIGH", icon:"⚠️", category:"STAFF",
            title:`Classe sans professeur : ${levelDisplay(cls)}`,
            detail:`Aucun professeur n'est affecté à la classe ${levelDisplay(cls)} dans l'emploi du temps.`,
            actionLabel:"Affecter un enseignant", actionTarget:"teacher-affectation", timestamp:new Date().toISOString() });
        }
      }
    }

    // 2. Probable teacher lateness.
    if (schoolHours) {
      const threshold = Number(conf.ATTENDANCE_ADMIN_ALERT_MIN || 10) || 10;
      const users = await getUsers(env.DB);
      const { results: todayStaff } = await env.DB.prepare(
        `SELECT email FROM staff_attendance WHERE org_id=? AND substr(timestamp,1,10)=? AND deleted_at IS NULL`
      ).bind(orgId, now.date).all();
      const confirmed = new Set((todayStaff || []).map(r => String(r.email || "").toLowerCase().trim()).filter(Boolean));
      const todayName = dayName(now.date).toLowerCase();
      for (const a of activeAssignments) {
        if (!a.teacher_name || !a.start_time) continue;
        const day = String(a.day || "").toLowerCase();
        if (day && day !== todayName && !day.startsWith(todayName.slice(0,3))) continue;
        const start = timeToMinutes(a.start_time);
        if (start === null) continue;
        const diff = now.hour * 60 + now.minute - start;
        if (diff > threshold && diff < 240) {
          const email = userEmailForTeacher(users, a.teacher_name);
          if (!email || !confirmed.has(email)) {
            alerts.push({ id:`late-teacher-${String(a.teacher_name).replace(/\s+/g,"-")}`,
              type:"ALERT", severity:"MEDIUM", icon:"⏰", category:"ATTENDANCE",
              title:`${a.teacher_name} — retard probable`,
              detail:`Devait être en classe ${a.class_name || ""} à ${a.start_time}. Aucun pointage aujourd'hui. Retard estimé: ${Math.round(diff)} min.`,
              requiresConfirmation:true,
              confirmQuestion:`${a.teacher_name} était-il/elle en retard ou absent(e) ?`,
              confirmOptions:["Retard confirmé","Absent(e)","Erreur — était présent(e)"],
              teacherEmail:email, className:String(a.class_name || ""), teacherName:String(a.teacher_name || ""),
              lateMinutes:Math.round(diff), timestamp:new Date().toISOString() });
          }
        }
      }
    }

    // 3. Student absences: today + recurrent threshold.
    const absenceThreshold = Number(conf.ATTENDANCE_ALERT_THRESHOLD || 3) || 3;
    const { results: att } = await env.DB.prepare(
      `SELECT student_id,status,date FROM attendance WHERE org_id=? AND grade_level_id!='STAFF' AND deleted_at IS NULL`
    ).bind(orgId).all();
    const absentCounts = {}, absentToday = new Set();
    for (const r of att || []) {
      if (String(r.status || "").toUpperCase() !== "ABSENT") continue;
      const sid = String(r.student_id || "").trim(); if (!sid) continue;
      absentCounts[sid] = (absentCounts[sid] || 0) + 1;
      if (String(r.date || "").slice(0,10) === now.date) absentToday.add(sid);
    }
    if (absentToday.size) {
      const ids = [...absentToday];
      alerts.push({ id:`absent-today-${now.date.replace(/-/g,"")}`, type:"ALERT", severity:"HIGH", icon:"🚫", category:"ATTENDANCE",
        title:"Élèves absents aujourd'hui",
        detail:`${ids.length} élève(s) absent(s): ${ids.slice(0,12).join(", ")}${ids.length>12?" ...":""}`,
        actionLabel:"Voir présences", actionTarget:"attendance", timestamp:new Date().toISOString() });
    }
    for (const [sid,count] of Object.entries(absentCounts)) {
      if (count >= absenceThreshold) alerts.push({ id:`recurrent-absent-${sid}`, type:"INFO", severity:"LOW", icon:"📋", category:"ATTENDANCE",
        title:`Absences récurrentes: ${sid}`, detail:`${count} absence(s) enregistrée(s). Seuil d'alerte: ${absenceThreshold}.`, studentId:sid,
        actionLabel:"Voir dossier", actionTarget:`student-profile:${sid}`, timestamp:new Date().toISOString() });
    }

    // Keep only categories the current viewer can see, matching Code.gs.
    const visible = alerts.filter(a => canSeeCategory(viewer, a.category));
    return { success:true, alerts:visible, data:visible, count:visible.length, timestamp:new Date().toISOString() };
  } catch (e) {
    return { success:false, error:e.message, alerts:[] };
  }
}

export async function confirmTeacherAlertStatus(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();
    if (!can(viewer,"p_attendance","p_staff","p_hr_attendance")) return { success:false, error:"Droits insuffisants." };
    const email = String(data?.teacherEmail || "").trim().toLowerCase();
    const status = String(data?.status || "").trim().toUpperCase();
    const className = String(data?.className || "").trim();
    if (!email || !status) return { success:false, error:"Données manquantes." };
    if (!["LATE","ABSENT","PRESENT"].includes(status)) return { success:false, error:"Statut enseignant invalide." };
    const orgId = await resolveOrgId(env);
    let id = null;
    if (["LATE","ABSENT"].includes(status)) {
      id = "SA-" + crypto.randomUUID().replace(/-/g,"").slice(0,12).toUpperCase();
      const ts = new Date().toISOString();
      const date = localNow().date;
      await env.DB.prepare(`INSERT INTO staff_attendance(id,org_id,email,name,status,late_minutes,class_name,confirmed_by,timestamp,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,NULL)`)
        .bind(id,orgId,email,String(data?.teacherName || ""),status,Math.max(0,Number(data?.lateMinutes||0)||0),className,String(viewer.email || viewer.user_id || "System"),ts,ts).run();
    }
    await writeAudit(env.DB,{table:"staff_attendance",rowId:id || email,userId:viewer.id,op:"alert_teacher_confirmed",diff:{status,email,className,lateMinutes:Number(data?.lateMinutes||0)||0}});
    return { success:true, status, message:`Statut enseignant confirmé: ${status}`, id, date:localNow().date };
  } catch(e) { return { success:false,error:e.message }; }
}

export async function getNotifications(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();

    const sys = await getSystemAlerts({}, auth, env);
    const systemAlerts = sys?.success && Array.isArray(sys.alerts) ? sys.alerts : [];
    const { results: stored } = await env.DB.prepare(
      `SELECT id, fields, version, updated_at, deleted_at
         FROM notifications
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 200`
    ).all();

    const rows = [];
    for (const a of systemAlerts) {
      if (!a) continue;
      rows.push({
        id: String(a.id || crypto.randomUUID()),
        title: String(a.title || 'Alerte système'),
        message: String(a.detail || ''),
        category: String(a.category || 'SYSTEM'),
        severity: String(a.severity || 'LOW'),
        createdAt: String(a.timestamp || new Date().toISOString()),
        read: false,
        requiresConfirmation: !!a.requiresConfirmation,
        confirmOptions: a.confirmOptions || [],
        teacherEmail: a.teacherEmail || '',
        teacherName: a.teacherName || '',
        className: a.className || '',
        lateMinutes: Number(a.lateMinutes || 0) || 0,
        actionLabel: a.actionLabel || '',
        actionTarget: a.actionTarget || ''
      });
    }

    for (const r of stored || []) {
      const f = parseJson(r.fields, {});
      if (!canSeeCategory(viewer, f.category)) continue;
      if (f.targetEmail && String(f.targetEmail).toLowerCase() !== String(viewer.email || '').toLowerCase() && !can(viewer,'p_staff','p_hr_attendance')) continue;
      rows.push({
        id: String(r.id),
        title: String(f.title || 'Notification'),
        message: String(f.message || f.detail || ''),
        category: String(f.category || 'SYSTEM'),
        severity: String(f.severity || 'LOW'),
        createdAt: String(f.createdAt || r.updated_at || new Date().toISOString()),
        read: false,
        actionLabel: f.actionLabel || '',
        actionTarget: f.actionTarget || ''
      });
    }

    const unique = new Map();
    for (const n of rows) if (!unique.has(n.id)) unique.set(n.id, n);

    const readRows = await env.DB.prepare(
      `SELECT notification_id FROM notification_reads WHERE user_id=?`
    ).bind(viewer.id || viewer.userId || viewer.email).all();
    const readSet = new Set((readRows.results || []).map(x => String(x.notification_id)));
    for (const n of unique.values()) n.read = readSet.has(n.id);

    const dataRows = [...unique.values()].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const lastSeenId = String(data?.lastSeenId || '').trim();
    const sinceRaw = String(data?.since || '').trim();
    const sinceTs = sinceRaw ? new Date(sinceRaw).getTime() : 0;
    let filtered = dataRows;
    if (lastSeenId || sinceTs) {
      filtered = dataRows.filter(n => {
        if (n.id === lastSeenId) return false;
        if (sinceTs && n.createdAt) return new Date(n.createdAt).getTime() > sinceTs;
        return true;
      });
    }
    const limited = filtered.slice(0, 50);
    return { success:true, data:limited, notifications:limited, count:filtered.length, forceRender:filtered.length>0 };
  } catch (e) {
    return { success:false, error:e.message, data:[], notifications:[] };
  }
}

export async function markNotificationRead(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();
    const id = String(data?.id || '').trim();
    if (!id) return { success:false, error:'Notification ID manquant.' };
    const userId = viewer.id || viewer.userId || viewer.email;
    const ts = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO notification_reads(notification_id,user_id,read_at)
       VALUES(?,?,?) ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at=excluded.read_at`
    ).bind(id,userId,ts).run();
    return { success:true, id, read:true, readAt:ts };
  } catch(e) { return { success:false,error:e.message }; }
}

export async function markAllNotificationsRead(_data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();
    const userId = viewer.id || viewer.userId || viewer.email;
    const sys = await getSystemAlerts({}, auth, env);
    const ids = (sys?.alerts || []).map(a => String(a?.id || '')).filter(Boolean);
    const { results: stored } = await env.DB.prepare(`SELECT id FROM notifications WHERE deleted_at IS NULL`).all();
    for (const r of stored || []) ids.push(String(r.id));
    const unique = [...new Set(ids)];
    if (unique.length) {
      const statements = unique.map(id => env.DB.prepare(
        `INSERT INTO notification_reads(notification_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at=excluded.read_at`
      ).bind(id,userId,new Date().toISOString()));
      await env.DB.batch(statements);
    }
    return { success:true, marked:unique.length };
  } catch(e) { return { success:false,error:e.message }; }
}

export async function notifyLateStaff(data, auth, env) {
  if (!auth?.token) return authError();
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return authError();
    const teacher = String(data?.teacher || '').trim();
    const email = String(data?.email || '').trim().toLowerCase();
    const lateMinutes = Number(data?.lateMinutes || 0);
    const at = data?.at || new Date().toISOString();
    if (!teacher) return { success:false,error:"Paramètre teacher requis." };
    if (!Number.isFinite(lateMinutes) || lateMinutes <= 0) return { success:false,error:"lateMinutes doit être un nombre positif." };

    const conf = await settingsMap(env.DB);
    const threshold = Number(conf.ATTENDANCE_ADMIN_ALERT_MIN);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return { success:false,error:"Paramètre ATTENDANCE_ADMIN_ALERT_MIN manquant ou invalide. Veuillez le configurer dans les Paramètres > Présence." };
    }
    if (lateMinutes < threshold) return { success:true,skipped:true,reason:`Retard (${lateMinutes} min) inférieur au seuil configuré (${threshold} min).` };

    const id = `NT-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
    const ts = new Date().toISOString();
    const fields = {
      title: `Retard enregistré — ${teacher}`,
      message: `Un retard de ${lateMinutes} minute(s) a été enregistré pour ${teacher}.`,
      category: 'ATTENDANCE', severity: 'MEDIUM', createdAt: at,
      targetEmail: email || '', teacher, lateMinutes, actionTarget: 'attendance'
    };
    await env.DB.prepare(
      `INSERT INTO notifications(id,fields,version,updated_at,deleted_at) VALUES(?,?,1,?,NULL)`
    ).bind(id,JSON.stringify(fields),ts).run();
    await writeAudit(env.DB,{table:'notifications',rowId:id,userId:viewer.id,op:'insert',diff:{category:'ATTENDANCE',teacher,email,lateMinutes}});
    return { success:true,teacher,lateMinutes,at,notificationId:id,emailSent:false,inApp:true };
  } catch(e) { return { success:false,error:'notifyLateStaff erreur: '+e.message }; }
}
