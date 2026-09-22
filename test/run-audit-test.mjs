import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { storeSessionToken } from '../src/lib/session.js';
import { writeAudit } from '../src/lib/audit.js';
import { actions } from '../src/actions/index.js';
import { apiHub } from '../src/lib/apiHub.js';

const path = '/tmp/eduhaiti-audit-test.sqlite';
for (const x of [path, path + '-shm', path + '-wal']) { try { fs.unlinkSync(x); } catch {} }
const db = makeD1(path);
db._raw.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','ORG1')`).run();
db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ACADEMIC_YEAR','2025-2026')`).run();

const env = { DB: db, ORG_ID: 'ORG1' };

// ── Users: an admin (p_audit) and a teacher with no audit/settings perms ──
const adminId = crypto.randomUUID();
db._raw.prepare(
  `INSERT INTO users(id,user_id,email,name,role,password_hash,active,is_master,permissions_json) VALUES(?,?,?,?,?,?,?,?,?)`
).run(adminId, 'ADM1', 'admin@school.ht', 'Admin', 'ADMIN', 'x', 1, 0, JSON.stringify({ p_audit: true, p_dossier: true, p_grades: true, p_settings: true }));
await storeSessionToken(db, 'admin-tok', { userId: adminId, email: 'admin@school.ht', role: 'ADMIN' });

const teacherId = crypto.randomUUID();
db._raw.prepare(
  `INSERT INTO users(id,user_id,email,name,role,password_hash,active,is_master,permissions_json) VALUES(?,?,?,?,?,?,?,?,?)`
).run(teacherId, 'TCH1', 'teacher@school.ht', 'Teacher', 'TEACHER', 'x', 1, 0, JSON.stringify({}));
await storeSessionToken(db, 'teacher-tok', { userId: teacherId, email: 'teacher@school.ht', role: 'TEACHER' });

const adminAuth = { token: 'admin-tok' };
const teacherAuth = { token: 'teacher-tok' };

// ── Seed some real audit_log rows the way other write actions already do ──
await writeAudit(db, { table: 'students', rowId: 'S-001', userId: adminId, op: 'insert', diff: { firstName: 'Jean' } });
await writeAudit(db, { table: 'payments', rowId: 'PAY-001', userId: adminId, op: 'insert', diff: { amount: 500 } });
await writeAudit(db, { table: 'students', rowId: 'S-001', userId: teacherId, op: 'update', diff: { currentLevel: '6EME' } });

// ── getGlobalAuditDashboard / getAuditLogs (alias) ──
{
  const dash = await actions.getGlobalAuditDashboard({}, adminAuth, env);
  assert.equal(dash.success, true);
  assert.equal(dash.total, 3);
  assert.equal(dash.filtered, 3);
  assert.equal(dash.data.length, 3);
  // newest first (default sort)
  assert.equal(dash.data[0].TableName, 'students');
  assert.equal(dash.data[0].Actor, teacherId);
  assert.ok(dash.data.every((r) => r.Status === 'REUSSITE'));
  assert.deepEqual(dash.filters.actions.sort(), ['insert', 'update']);

  const viaAlias = await actions.getAuditLogs({}, adminAuth, env);
  assert.equal(viaAlias.total, 3);
}

// filter by table via Target substring
{
  const filtered = await actions.getGlobalAuditDashboard({ target: 'payments' }, adminAuth, env);
  assert.equal(filtered.filtered, 1);
  assert.equal(filtered.data[0].TableName, 'payments');
}

// ── Permission gate: teacher lacks p_audit/p_settings/pa_save_settings ──
{
  const denied = await actions.getGlobalAuditDashboard({}, teacherAuth, env);
  assert.equal(denied.success, false);
}

// ── Same check through the real apiHub dispatcher (exercises
//    ACTION_PERMISSIONS/UNPOLICED_ACTIONS wiring, not just the handler) ──
{
  const allowed = await apiHub('getAuditLogs', {}, 'admin-tok', env);
  assert.equal(allowed.success, true);
  assert.equal(allowed.total, 3);

  const rejected = await apiHub('getAuditLogs', {}, 'teacher-tok', env);
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /Permission/i);

  const noToken = await apiHub('getAuditLogs', {}, null, env);
  assert.equal(noToken.success, false);
}

// ── getAuditDiagnostics: unauthenticated/no-permission-required, both via
//    the handler directly and through apiHub's UNPOLICED_ACTIONS-style
//    open policy entry ([]) ──
{
  const diag = await actions.getAuditDiagnostics({}, null, env);
  assert.equal(diag.success, true);
  assert.equal(diag.auditLastRow, 5);
  assert.equal(diag.sampleRows.length, 3);

  const viaHub = await apiHub('getAuditDiagnostics', {}, null, env);
  assert.equal(viaHub.success, true);
}

// ── getAvailableAcademicYears ──
{
  const noArchive = await actions.getAvailableAcademicYears({}, adminAuth, env);
  assert.equal(noArchive.success, true);
  assert.deepEqual(noArchive.data, ['2025-2026']);

  const noAuth = await actions.getAvailableAcademicYears({}, null, env);
  assert.equal(noAuth.success, false);
}

// Roll the year over once, then confirm both years show up, newest first.
{
  const roll = await actions.rolloverAcademicYear({}, adminAuth, env);
  assert.equal(roll.success, true);
  assert.equal(roll.newYear, '2026-2027');

  const years = await actions.getAvailableAcademicYears({}, adminAuth, env);
  assert.equal(years.success, true);
  assert.deepEqual(years.data, ['2026-2027', '2025-2026']);
}

// ── getStudentFieldsConfig ──
{
  // No students yet: only the 11 fixed system fields.
  const empty = await actions.getStudentFieldsConfig({}, null, env);
  assert.equal(empty.success, true);
  assert.equal(empty.data.length, 11);
  assert.ok(empty.data.every((f) => f.isSystem && f.isLocked && f.enabled && f.required));

  // A student with an extra custom field shows up as a discovered,
  // non-system, non-locked field.
  const ts = new Date().toISOString();
  db._raw.prepare(
    `INSERT INTO students(id,student_code,org_id,first_name,last_name,custom_fields,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?)`
  ).run(crypto.randomUUID(), 'STU-001', 'ORG1', 'Jean', 'Baptiste', JSON.stringify({ NISU: '1234' }), ts, ts);

  const withCustom = await actions.getStudentFieldsConfig({}, null, env);
  assert.equal(withCustom.data.length, 12);
  const nisu = withCustom.data.find((f) => f.id === 'NISU');
  assert.ok(nisu, 'discovered NISU custom field');
  assert.equal(nisu.isSystem, false);
  assert.equal(nisu.isLocked, false);
  assert.equal(nisu.enabled, true);

  // Saved customization overrides label/required for the discovered field,
  // and can also disable a non-locked system-adjacent field.
  await db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)`)
    .bind('STUDENT_FIELDS_CONFIG', JSON.stringify([{ id: 'NISU', label: 'N° NISU', required: true, enabled: true }]), ts)
    .run();

  const customized = await actions.getStudentFieldsConfig({}, null, env);
  const nisu2 = customized.data.find((f) => f.id === 'NISU');
  assert.equal(nisu2.label, 'N° NISU');
  assert.equal(nisu2.required, true);
  // Locked system fields are never overridable, even if a saved config
  // tried to disable one.
  const code = customized.data.find((f) => f.id === 'StudentCode');
  assert.equal(code.enabled, true);
  assert.equal(code.isLocked, true);
}

console.log('audit / academic-year / student-fields-config tests passed');
