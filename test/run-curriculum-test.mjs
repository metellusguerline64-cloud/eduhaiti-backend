import assert from 'node:assert/strict';
import { makeD1 } from './d1shim.mjs';
import { getSubjectsByLevel, getFullCurriculum, saveChunkedCurriculum } from '../src/actions/curriculum.js';
import { storeSessionToken } from '../src/lib/session.js';
import fs from 'node:fs/promises';

const schema = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const db = makeD1(':memory:');
db._raw.exec(schema);
const env = { DB: db, ORG_ID: 'test' };

await db.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','test')`).run();

await db.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode)
  VALUES('u1','u1','admin@test','Admin','ADMIN',1,'x',?,0,0)`)
  .bind(JSON.stringify({ pa_save_settings:true, p_settings:true }))
  .run();
await storeSessionToken(db, 'curriculum-token', { userId:'u1', email:'admin@test' }, 3600);

await db.prepare(`INSERT INTO settings(key,value) VALUES('CURRICULUM_FOND_1AF',?)`)
  .bind(JSON.stringify([{ id:'FR', label:'Français', coeff:300, branches:[
    { label:'Lecture', max:100 }, { label:'Grammaire', max:100 }, { label:'Orthographe', max:100 }
  ] }])).run();
await db.prepare(`INSERT INTO settings(key,value) VALUES('CURRICULUM_NS1',?)`)
  .bind(JSON.stringify([{ id:'MATH', label:'Mathématiques', coeff:100 }])).run();

let r = await getSubjectsByLevel({level:'fond_1af'}, {token:'curriculum-token'}, env);
assert.equal(r.length, 1);
assert.equal(r[0].id, 'FR');
assert.equal(r[0].label, 'Français');

r = await saveChunkedCurriculum({
  fond_1af: [{ id:'FR', label:'Français', coeff:300, branches:[
    { label:'Lecture', max:50 }, { label:'Grammaire', max:50 }
  ] }],
  ns1: [{ id:'MATH', label:'Mathématiques', coeff:100 }],
}, {token:'curriculum-token'}, env);
assert.equal(r.success, true);
assert.deepEqual(r.resyncedSubjects, ['Français']);
assert.deepEqual(r.curriculum.fond_1af[0].branches.map(b => b.max), [150,150]);

const school = await db.prepare(`SELECT value FROM settings WHERE key='SCHOOL_CURRICULUM'`).first();
const schoolCurr = JSON.parse(school.value);
assert.equal(schoolCurr.fond_1af[0].coeff, 300);
assert.deepEqual(schoolCurr.fond_1af[0].branches.map(b => b.max), [150,150]);
assert.equal(schoolCurr.ns1[0].id, 'MATH');

r = await getFullCurriculum({}, {token:'curriculum-token'}, env);
assert.equal(r.success, true);
assert.equal(r.curriculum.fond_1af.length, 1);

const audit = await db.prepare(`SELECT table_name,row_id,op FROM audit_log WHERE row_id='SCHOOL_CURRICULUM'`).all();
assert.equal(audit.results.length, 1);
assert.equal(audit.results[0].op, 'CURRICULUM_SAVED');

const noPerm = await db.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode)
  VALUES('u2','u2','teacher@test','Teacher','TEACHER',1,'x',?,0,0)`)
  .bind(JSON.stringify({})).run();
await storeSessionToken(db, 'teacher-token', { userId:'u2', email:'teacher@test' }, 3600);
r = await saveChunkedCurriculum({ ns1:[] }, {token:'teacher-token'}, env);
assert.equal(r.success, false);
assert.equal(r.error, 'Droits insuffisants.');

console.log('curriculum tests passed');
