import assert from 'node:assert/strict';
import { makeD1 } from './d1shim.mjs';
import { getStudentBulletinData, checkStudentBulletinDownloadAllowed } from '../src/actions/bulletin.js';
import { saveHomework, gradeHomework } from '../src/actions/media_homework.js';
import { storeSessionToken } from '../src/lib/session.js';
import fs from 'node:fs/promises';

const schema = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const db = makeD1(':memory:'); db._raw.exec(schema);
const env = { DB: db, ORG_ID: 'test' };

await db.prepare("INSERT INTO settings(key,value) VALUES('ORG_ID','test')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('MAX_SCORE','20')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('PROMOTION_SCORE','60')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('PASSING_SCORE','40')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('TUITION_AMOUNT_GLOBAL','1000')").run();

await db.prepare(
  "INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('u1','u1','admin@test','Admin','ADMIN',1,?, ?,0,0)"
).bind('x', JSON.stringify({ p_grades: true, pa_generate_report: true, pa_save_settings: true })).run();
await db.prepare(
  "INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('s1','s1','student@test','Jean Pierre','STUDENT',1,?, ?,0,0)"
).bind('x', JSON.stringify({ pt_download_bulletin: true })).run();
// A second student, missing the download permission, for the permission-gate case.
await db.prepare(
  "INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('s2','s2','nodownload@test','No Download','STUDENT',1,?, ?,0,0)"
).bind('x', JSON.stringify({})).run();

await storeSessionToken(db, 'admin-token', { userId: 'u1', email: 'admin@test' }, 3600);
await storeSessionToken(db, 'student-token', { userId: 's1', email: 'student@test' }, 3600);
await storeSessionToken(db, 'nodownload-token', { userId: 's2', email: 'nodownload@test' }, 3600);

await db.prepare(
  "INSERT INTO students(id,org_id,student_code,first_name,last_name,current_level,section,active,enrollment_status) VALUES ('st1','test','S1','Jean','Pierre','NS1','A',1,'ACTIVE'),('st2','test','S2','No','Download','NS1','A',1,'ACTIVE')"
).run();
await db.prepare(
  "INSERT INTO student_history(id,history_id,student_id,org_id,school_year,grade_level_id,section,status) VALUES ('h1','HIS1','S1','test','2025-2026','NS1','A','ACTIVE'),('h2','HIS2','S2','test','2025-2026','NS1','A','ACTIVE')"
).run();
await db.prepare(
  "INSERT INTO grades(id,student_id,org_id,grade_level_id,subject_id,period_id,score,scores_json) VALUES ('g1','S1','test','NS1','MATH','T1',15,'{\"T1\":15,\"T2\":16}')"
).run();

const adminAuth = { token: 'admin-token' };
const studentAuth = { token: 'student-token' };
const noDownloadAuth = { token: 'nodownload-token' };

// === getStudentBulletinData: staff session, gate never configured (off by default) ===
{
  const r = await getStudentBulletinData({ studentId: 'S1' }, adminAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.student.name, 'JEAN PIERRE');
  assert.equal(r.singleSubjectMode, false);
  assert.ok(Array.isArray(r.student.scores));
}

// === getStudentBulletinData: student's own session, gate off — unaffected ===
{
  const r = await getStudentBulletinData({ studentId: 'S1' }, studentAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.student.id, 'S1');
}

// === checkStudentBulletinDownloadAllowed: staff/admin never gated ===
{
  const r = await checkStudentBulletinDownloadAllowed({ studentId: 'S1' }, adminAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.allowed, true);
}

// === checkStudentBulletinDownloadAllowed: missing pt_download_bulletin permission ===
{
  const r = await checkStudentBulletinDownloadAllowed({ studentId: 'S2' }, noDownloadAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'permission');
}

// === Turn the payment gate on: 50% paid, 80% threshold, scope DOWNLOAD (default) ===
await db.prepare("INSERT INTO settings(key,value) VALUES('SP_BULLETIN_PAYMENT_GATE','true')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('SP_BULLETIN_PAYMENT_THRESHOLD_PCT','80')").run();
await db.prepare(
  "INSERT INTO payments(id,org_id,student_id,student_name,description,amount,status,payment_date) VALUES ('p1','test','S1','Jean Pierre','Scolarité','500','PAID',date('now'))"
).run();

{
  // Default scope is DOWNLOAD — VIEW must stay unaffected.
  const view = await getStudentBulletinData({ studentId: 'S1' }, studentAuth, env);
  assert.equal(view.success, true);

  // DOWNLOAD is gated: 50% < 80% threshold.
  const dl = await checkStudentBulletinDownloadAllowed({ studentId: 'S1' }, studentAuth, env);
  assert.equal(dl.success, true);
  assert.equal(dl.allowed, false);
  assert.equal(dl.reason, 'payment');
  assert.equal(dl.paidPct, 50);
  assert.equal(dl.thresholdPct, 80);
}

// === Pay the rest of the way past threshold: 90% paid — download unlocks ===
await db.prepare(
  "INSERT INTO payments(id,org_id,student_id,student_name,description,amount,status,payment_date) VALUES ('p2','test','S1','Jean Pierre','Scolarité','400','PAID',date('now'))"
).run();
{
  const dl = await checkStudentBulletinDownloadAllowed({ studentId: 'S1' }, studentAuth, env);
  assert.equal(dl.success, true);
  assert.equal(dl.allowed, true);
}

// === Widen scope to VIEW: now getStudentBulletinData itself gates on the same rule ===
await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('SP_BULLETIN_PAYMENT_SCOPE','VIEW')").run();
// Drop back below threshold to prove VIEW is now actually enforced.
await db.prepare("UPDATE payments SET amount='0' WHERE id='p2'").run();
{
  const view = await getStudentBulletinData({ studentId: 'S1' }, studentAuth, env);
  assert.equal(view.success, false);
  assert.equal(view.paymentBlocked, true);
  assert.equal(view.paymentGate.reason, 'payment');
}
// Staff/admin still unaffected by VIEW scope.
{
  const view = await getStudentBulletinData({ studentId: 'S1' }, adminAuth, env);
  assert.equal(view.success, true);
}
// Restore payment for the next block, and drop the gate for single-subject-mode tests below.
await db.prepare("UPDATE payments SET amount='400' WHERE id='p2'").run();
await db.prepare("UPDATE settings SET value='false' WHERE key='SP_BULLETIN_PAYMENT_GATE'").run();

// === SINGLE_SUBJECT_MODE: bulletin lines come from graded homework ===
await db.prepare("INSERT INTO settings(key,value) VALUES('SINGLE_SUBJECT_MODE','true')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('SINGLE_SUBJECT_NAME','Couture')").run();
await db.prepare("INSERT INTO settings(key,value) VALUES('SINGLE_SUBJECT_COEF','2')").run();

const hw = await saveHomework({ title: 'Ourlet', subject: 'Couture', classes: ['NS1'], max_score: 10, status: 'ACTIVE' }, adminAuth, env);
assert.equal(hw.success, true);
await gradeHomework({ homeworkId: hw.id, grades: [{ studentId: 'S1', studentName: 'Jean Pierre', className: 'NS1', score: 8 }] }, adminAuth, env);

{
  const r = await getStudentBulletinData({ studentId: 'S1' }, adminAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.singleSubjectMode, true);
  assert.equal(r.singleSubject.name, 'Couture');
  assert.equal(r.singleSubject.coef, 2);
  assert.equal(r.student.scores.length, 1);
  assert.equal(r.student.scores[0].subject, 'Ourlet');
  // 8/10 raw onto the configured MAX_SCORE=20 scale -> 16.
  assert.equal(r.student.scores[0].score, 16);
  assert.equal(r.student.scores[0].coeff, 2);
}

// === Security regression: a student cannot preflight another student's bulletin ===
{
  const r = await checkStudentBulletinDownloadAllowed({ studentId: 'S2' }, studentAuth, env);
  assert.equal(r.success, true);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'scope');
}

console.log('bulletin/download-gating tests passed');
