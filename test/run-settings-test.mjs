import assert from 'node:assert/strict';
import { makeD1 } from './d1shim.mjs';
import { storeSessionToken } from '../src/lib/session.js';
import { getSaaSSettings, updateSaaSSettings, getSettingsHealth, cleanupSettingsDuplicates } from '../src/actions/settings.js';
import fs from 'node:fs/promises';

const schema=await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8');
const db=makeD1(':memory:'); db._raw.exec(schema);
const env={DB:db,ORG_ID:'ORG-TEST'};
await db.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('u1','u1','admin@test','Admin','ADMIN',1,'x',?,0,0)`).bind(JSON.stringify({p_settings:true,pa_save_settings:true})).run();
await storeSessionToken(db,'settings-token',{userId:'u1',email:'admin@test'},3600);

let r=await getSaaSSettings({}, {token:'settings-token'}, env);
assert.equal(r.success,true); assert.equal(r.data.orgId,'ORG-TEST');
assert.equal(r.data.configurationStatus.isOperational,false);

r=await updateSaaSSettings({schoolName:'École Test',orgId:'ORG-TEST',schoolCode:'ET01',currentAcademicYear:'2026-2027',schoolPhone:'50900000000',schoolEmail:'test@school.ht',schoolAddress:'Port-au-Prince',academicStructure:['fond_1af'],gradingType:'100',NUM_PERIODS:3,maxScore:100,passingScore:60,PROMOTION_MIN_AVG:60,ACTIVE_LEVELS:['fond_1af'],currency:'USD',TUITION_MODE:'MONTHLY',SCHOOL_CURRICULUM:{fond_1af:[{id:'FR',label:'Français',coeff:100}]},notifyAbsence:false}, {token:'settings-token'}, env);
assert.equal(r.success,true); assert.equal(r.count,18);

r=await getSaaSSettings({}, {token:'settings-token'}, env);
assert.equal(r.data.schoolName,'École Test');
// Code.gs's normalizeSaaSSettingsAcademicYear_ always coerces NUM_PERIODS
// to a clamped [1,5] number before returning, even though the value was
// saved as an integer — getSaaSSettings_ ran this on every read.
assert.equal(r.data.NUM_PERIODS, 3);
assert.equal(r.data.SCHOOL_CURRICULUM.fond_1af[0].id,'FR');
assert.equal(r.data.configurationStatus.isOperational,true);

r=await getSettingsHealth({}, {token:'settings-token'}, env); assert.equal(r.duplicates.schoolName,undefined); assert.equal(r.healthy,true);
r=await cleanupSettingsDuplicates({}, {token:'settings-token'}, env); assert.equal(r.success,true); assert.equal(r.duplicatesRemoved,0);

console.log('settings tests passed');
