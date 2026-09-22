import { loadSessionToken } from "./session.js";
import { resolveOrgId } from "./org.js";

export const STRICT_SCOPE_KEYS = [
  "pt_view_class_list", "pt_view_student_profile", "pt_view_history",
  "pt_view_photo", "pt_view_contact", "pt_mark_attendance",
  "pt_view_attendance", "pt_enter_grades", "pt_edit_grades",
  "pt_view_bulletin", "pt_view_class_perf", "pt_view_ranking",
];

function norm(v) {
  return String(v ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
function cycle(v) {
  const x = norm(v);
  if (!x) return "";
  if (x.includes("MAT")) return "MATERNELLE";
  if (x.includes("FOND") || x.includes("PRIMA") || x === "AF") return "FONDAMENTAL";
  if (/^NS[1-4]$/.test(x) || x.includes("SECOND") || x.includes("RHETO") || x.includes("PHILO") || x.includes("TERM") || x.includes("LYCEE") || x.includes("COLLEGE")) return "SECONDAIRE";
  if (x.includes("MASTER")) return "UNI_MASTER";
  if (x.includes("LICENCE") || x.includes("UNIVERS")) return "UNI_LICENCE";
  if (x.includes("DIP")) return "PROF_DIP";
  if (x.includes("PROF") || x.includes("CERT")) return "PROF_CERT";
  return "";
}
function addUnique(arr, seen, value) {
  const s = String(value ?? "").trim(); const n = norm(s);
  if (!s || !n || seen[n]) return; seen[n] = true; arr.push(s);
}
function parseScope(raw) {
  const out = { classes: [], cycles: [], studentIds: [], selfOnly: false, restricted: false };
  const seen = { classes: {}, cycles: {}, studentIds: {} };
  const visit = (v) => {
    if (v == null || v === "") return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v === "string") {
      const t=v.trim();
      if (!t) return;
      if ((t.startsWith("{")&&t.endsWith("}"))||(t.startsWith("[")&&t.endsWith("]"))) { try { return visit(JSON.parse(t)); } catch {} }
      let m=t.match(/^class\s*:\s*(.+)$/i); if(m) return addUnique(out.classes,seen.classes,m[1]);
      m=t.match(/^cycle\s*:\s*(.+)$/i); if(m){ const c=cycle(m[1]); if(c&&!seen.cycles[c]){seen.cycles[c]=true;out.cycles.push(c);} return; }
      m=t.match(/^student\s*:\s*(.+)$/i); if(m) return addUnique(out.studentIds,seen.studentIds,m[1]);
      if (/^self\s*:?$/i.test(t)) { out.selfOnly=true; return; }
      const c=cycle(t); if(c&&!seen.cycles[c]){seen.cycles[c]=true;out.cycles.push(c);} return;
    }
    if (typeof v === "object") {
      ["classes","classesAllowed","assignedClasses"].forEach(k => Array.isArray(v[k]) && v[k].forEach(x=>addUnique(out.classes,seen.classes,x)));
      ["cycles","cyclesAllowed","assignedCycles"].forEach(k => Array.isArray(v[k]) && v[k].forEach(x=>{const c=cycle(x);if(c&&!seen.cycles[c]){seen.cycles[c]=true;out.cycles.push(c)}}));
      ["studentIds","students","studentsAllowed","allowedStudentIds","assignedStudentIds"].forEach(k => Array.isArray(v[k]) && v[k].forEach(x=>addUnique(out.studentIds,seen.studentIds,x)));
      if(v.className) addUnique(out.classes,seen.classes,v.className); if(v.classId) addUnique(out.classes,seen.classes,v.classId);
      if(v.cycle){const c=cycle(v.cycle);if(c&&!seen.cycles[c]){seen.cycles[c]=true;out.cycles.push(c)}}
      if(v.cycleKey){const c=cycle(v.cycleKey);if(c&&!seen.cycles[c]){seen.cycles[c]=true;out.cycles.push(c)}}
      if(v.studentId) addUnique(out.studentIds,seen.studentIds,v.studentId); if(v.studentCode) addUnique(out.studentIds,seen.studentIds,v.studentCode);
      if(v.selfOnly===true||v.onlySelf===true) out.selfOnly=true;
    }
  };
  visit(raw); out.restricted=!!(out.classes.length||out.cycles.length||out.studentIds.length||out.selfOnly); return out;
}

export async function loadViewer(env, auth) {
  if (!auth?.token) return null;
  const session=await loadSessionToken(env.DB, auth.token); if(!session) return null;
  const row=await env.DB.prepare(`SELECT id,user_id,email,username,name,role,active,permissions_json,assigned_subjects,is_teacher,is_master,is_god_mode FROM users WHERE deleted_at IS NULL AND (id=? OR user_id=? OR email=?)`).bind(session.userId,session.userId,session.email||"").first();
  // During the staged migration some legacy/unit-test sessions can exist before
  // their Users row has been imported. Keep those sessions unrestricted here;
  // the public apiHub permission gate still rejects a token it cannot resolve
  // to a real user for any protected action.
  if(!row) return { id:session.userId, userId:session.userId, email:session.email||"", permissions:{}, assignedSubjects:{}, accessScope:{classes:[],cycles:[],studentIds:[],selfOnly:false,restricted:false}, isMaster:false, isGodMode:false };
  if(Number(row.active)===0) return null;
  let permissions={}; let assignedSubjects={};
  try{permissions=JSON.parse(row.permissions_json||"{}")}catch{}
  try{assignedSubjects=JSON.parse(row.assigned_subjects||"{}")}catch{}
  const teacherTokens=[row.name,row.email,row.user_id,row.username].map(norm).filter(Boolean);
  const assigned = parseScope(assignedSubjects);
  // A teacher's Affectation rows are authoritative scope when their account has pt_* permissions.
  try {
    const orgId=await resolveOrgId(env);
    const {results}=await env.DB.prepare(`SELECT teacher_name,teacher_id,class_name,class_id FROM teacher_assignments WHERE org_id=? AND deleted_at IS NULL AND active=1`).bind(orgId).all();
    for(const r of results||[]) {
      const rt=[r.teacher_name,r.teacher_id,r.class_name,r.class_id].map(norm);
      if(teacherTokens.some(t=>t&&rt.includes(t))) addUnique(assigned.classes, Object.fromEntries(assigned.classes.map(x=>[norm(x),true])), r.class_name);
    }
  } catch {}
  assigned.restricted=!!(assigned.classes.length||assigned.cycles.length||assigned.studentIds.length||assigned.selfOnly);
  return { id:row.id,userId:row.user_id||row.id,email:row.email||"",name:row.name||"",username:row.username||"",role:row.role||"",active:Number(row.active)!==0,permissions,isTeacher:Number(row.is_teacher)===1,assignedSubjects,accessScope:assigned,isMaster:Number(row.is_master)===1,isGodMode:Number(row.is_god_mode)===1 };
}

export function canAccessStudent(viewer, student) {
  if(!viewer || viewer.isMaster || viewer.isGodMode) return {allowed:true};
  if(!STRICT_SCOPE_KEYS.some(k=>viewer.permissions?.[k])) return {allowed:true};
  const s=viewer.accessScope||parseScope(viewer.assignedSubjects);
  if(!s.restricted) return {allowed:false,error:"Accès refusé : aucun élève ou aucune classe n’est assigné à ce compte."};
  const sid=String(student?.StudentCode||student?.studentCode||student?.StudentID||student?.studentId||student?.id||"").trim();
  if(s.selfOnly && norm(sid)!==norm(viewer.userId) && norm(sid)!==norm(viewer.email)) return {allowed:false,error:"Accès refusé : ce compte ne peut consulter que son propre dossier."};
  if(s.studentIds.length && s.studentIds.some(x=>norm(x)===norm(sid))) return {allowed:true};
  const level=String(student?.CurrentLevel||student?.currentLevel||student?.GradeLevelID||student?.grade_level_id||student?.level||"").trim();
  const section=String(student?.Section||student?.section||"").trim();
  if(s.classes.length && s.classes.some(c=>norm(c)===norm(level)||norm(c)===norm(level+(section?" "+section:"")))) return {allowed:true};
  const c=cycle(level); if(c && s.cycles.includes(c)) return {allowed:true};
  return {allowed:false,error:"Accès refusé : ce dossier est hors de la classe / du cycle assigné."};
}

export async function getStudentForAccess(env, orgId, studentId) {
  return env.DB.prepare(`SELECT student_code,first_name,last_name,current_level,section,custom_fields FROM students WHERE org_id=? AND student_code=? AND deleted_at IS NULL`).bind(orgId,studentId).first();
}
export async function assertStudentAccess(env, auth, orgId, studentId) {
  const viewer=await loadViewer(env,auth); if(!viewer) return {allowed:false,error:"Session expirée ou invalide."};
  const row=await getStudentForAccess(env,orgId,studentId); if(!row) return {allowed:false,error:"Élève introuvable: "+studentId};
  return {...canAccessStudent(viewer,row),viewer,student:row};
}

export function filterStudents(viewer, rows) {
  if(!viewer || viewer.isMaster || viewer.isGodMode || !STRICT_SCOPE_KEYS.some(k=>viewer.permissions?.[k])) return rows;
  return rows.filter(r=>canAccessStudent(viewer,r).allowed);
}
