import assert from 'node:assert/strict';
import { makeD1 } from './d1shim.mjs';
import { actions } from '../src/actions/index.js';
import { storeSessionToken } from '../src/lib/session.js';
import fs from 'node:fs';

for (const f of ['/tmp/alerts-test.sqlite','/tmp/alerts-test.sqlite-shm','/tmp/alerts-test.sqlite-wal']) { try { fs.unlinkSync(f); } catch {} }
const db = makeD1('/tmp/alerts-test.sqlite');
db._raw.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

const now = new Date().toISOString();
await db.prepare(`INSERT INTO users(id,user_id,email,name,password_hash,permissions_json,is_master,is_god_mode,active) VALUES(?,?,?,?,?,?,?,?,1)`)
  .bind('u1','U1','admin@example.com','Admin','x',JSON.stringify({p_staff:true,p_attendance:true,p_hr_attendance:true}),0,0).run();
const token='tok-alerts';
await storeSessionToken(db, token, { userId:'u1', email:'admin@example.com' }, 86400000);

for (const [k,v] of Object.entries({ATTENDANCE_ADMIN_ALERT_MIN:'10',ATTENDANCE_ALERT_THRESHOLD:'2',ACTIVE_LEVELS:'[{"id":"sec_ns2","label":"NS2"}]',NO_CLASS_WEEKDAYS_AUTO:'0'}))
  await db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)`).bind(k,v,now).run();

await db.prepare(`INSERT INTO teacher_assignments(id,org_id,teacher_name,teacher_id,class_name,subject,day,start_time,end_time,hours,rate,salary,payment_mode,active,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NULL)`)
  .bind('ta1','default','Missing Teacher','T1','sec_ns1','Math','Monday','08:00','09:00',1,10,0,'HOURLY',1,now).run();
await db.prepare(`INSERT INTO attendance(id,student_id,org_id,grade_level_id,date,status,recorded_by,meta_json,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,1,?,NULL)`)
  .bind('a1','STU-1','default','sec_ns1',new Intl.DateTimeFormat('en-CA',{timeZone:'America/Port-au-Prince'}).format(new Date()),'ABSENT','admin','{}',now).run();
await db.prepare(`INSERT INTO attendance(id,student_id,org_id,grade_level_id,date,status,recorded_by,meta_json,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,1,?,NULL)`)
  .bind('a2','STU-1','default','sec_ns1','2026-09-10','ABSENT','admin','{}',now).run();

const env={DB:db,ORG_ID:'default'};
const alerts=await actions.getSystemAlerts({}, {token}, env);
assert.equal(alerts.success,true);
assert.ok(alerts.alerts.some(a=>a.id==='no-teacher-sec_ns2'));
assert.ok(alerts.alerts.some(a=>a.id==='recurrent-absent-STU-1'));

const confirmed=await actions.confirmTeacherAlertStatus({teacherEmail:'teacher@example.com',teacherName:'Teacher',status:'LATE',className:'sec_ns1',lateMinutes:15},{token},env);
assert.equal(confirmed.success,true);
const sa=await db.prepare(`SELECT status,late_minutes,class_name,confirmed_by FROM staff_attendance`).all();
assert.equal(sa.results.length,1);
assert.equal(sa.results[0].status,'LATE');
assert.equal(sa.results[0].late_minutes,15);

const note=await actions.notifyLateStaff({teacher:'Teacher',email:'teacher@example.com',lateMinutes:15},{token},env);
assert.equal(note.success,true);
assert.equal(note.emailSent,false);
assert.equal(note.inApp,true);
const notifs=await actions.getNotifications({}, {token}, env);
assert.equal(notifs.success,true);
assert.ok(notifs.notifications.some(n=>n.id===note.notificationId));
const mark=await actions.markNotificationRead({id:note.notificationId},{token},env);
assert.equal(mark.success,true);
const notifs2=await actions.getNotifications({}, {token}, env);
assert.ok(notifs2.notifications.some(n=>n.id===note.notificationId && n.read===true));
const all=await actions.markAllNotificationsRead({}, {token}, env);
assert.equal(all.success,true);

console.log('alerts tests passed');
