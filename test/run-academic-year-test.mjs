import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { actions } from '../src/actions/index.js';
import { storeSessionToken } from '../src/lib/session.js';
const f='/tmp/academic-year-test.sqlite'; for(const x of [f,f+'-shm',f+'-wal']){try{fs.unlinkSync(x)}catch{}}
const db=makeD1(f); db._raw.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
const ts=new Date().toISOString();
await db.prepare(`INSERT INTO users(id,user_id,email,name,password_hash,permissions_json,is_master,is_god_mode,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind('u1','U1','admin@example.com','Admin','x',JSON.stringify({p_settings:true,pa_save_settings:true}),0,0).run();
await storeSessionToken(db,'tok-ay',{userId:'u1',email:'admin@example.com'},86400000);
await db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)`).bind('ACADEMIC_YEAR','2025-2026',ts).run();
await db.prepare(`INSERT INTO grades(id,student_id,org_id,subject_id,scores_json,version,updated_at) VALUES(?,?,?,?,?,1,?)`).bind('g1','S1','default','MATH','{"T1":15}',ts).run();
const env={DB:db,ORG_ID:'default'}; const r=await actions.rolloverAcademicYear({}, {token:'tok-ay'}, env); assert.equal(r.success,true); assert.equal(r.newYear,'2026-2027'); assert.equal((await db.prepare(`SELECT COUNT(*) c FROM grades WHERE org_id='default' AND deleted_at IS NULL`).first()).c,0);
const st=await actions.getAcademicYearRolloverStatus({}, {token:'tok-ay'}, env); assert.equal(st.canReset,true);
const reset=await actions.resetAcademicYearRollover({}, {token:'tok-ay'}, env); assert.equal(reset.success,true); assert.equal(reset.restoredYear,'2025-2026'); assert.equal((await db.prepare(`SELECT COUNT(*) c FROM grades WHERE org_id='default'`).first()).c,1); assert.equal((await db.prepare(`SELECT value FROM settings WHERE key='ACADEMIC_YEAR'`).first()).value,'2025-2026');
console.log('academic year tests passed');
