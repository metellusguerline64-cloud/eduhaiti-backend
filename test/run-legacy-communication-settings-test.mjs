import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeD1 } from './d1shim.mjs';
import * as communications from '../src/actions/communications.js';
import { updateStudentPortalUrl, saveUserTheme, updateMyProfilePhoto, clearMeigensConfiguration, uploadLogoToDriveSecure, uploadPwaScreenshotToDriveSecure } from '../src/actions/legacy_settings_profile.js';

const db=makeD1(':memory:');
db._raw.exec(fs.readFileSync(fileURLToPath(new URL('../schema.sql',import.meta.url)),'utf8'));
db._raw.exec(fs.readFileSync(fileURLToPath(new URL('../migrations/0016_communication.sql',import.meta.url)),'utf8'));
db._raw.exec(fs.readFileSync(fileURLToPath(new URL('../migrations/0028_parent_portal.sql',import.meta.url)),'utf8'));
await db.prepare(`INSERT INTO users(id,user_id,email,name,password_hash,permissions_json,is_master,is_god_mode,active) VALUES('u1','u1','admin@test','Admin','x','{"pa_send_broadcast":true,"pa_save_settings":true,"pa_generate_report":true,"pt_view_bulletin":true}',1,0,1)`).run();
await db.prepare(`INSERT INTO students(id,student_code,org_id,first_name,last_name,current_level,section,enrollment_status,active) VALUES('s1','STU1','MT1967','Jean','Test','sec_ns1','A','ACTIVE',1)`).run();
await db.prepare(`INSERT INTO student_history(id,history_id,student_id,org_id,school_year,grade_level_id,status) VALUES('h1','H1','STU1','MT1967','2026-2027','sec_ns1','ACTIVE')`).run();
await db.prepare(`INSERT INTO sessions(token,user_id,email,payload,expires_at) VALUES('tok','u1','admin@test','{"userId":"u1","email":"admin@test"}',9999999999999)`).run();
const env={DB:db,ORG_ID:'MT1967'}; const auth={token:'tok'};

assert.equal(communications.sendSMSBulk, undefined);
assert.equal(communications.testSMSConnection, undefined);
assert.equal(communications.sendWhatsApp, undefined);

await db.prepare(`INSERT INTO parent_accounts(id,org_id,phone,display_name,active,must_change_password,created_at,updated_at) VALUES('p1','MT1967','50911111111','Parent Test',1,0,?,?)`).bind(new Date().toISOString(),new Date().toISOString()).run();
await db.prepare(`INSERT INTO parent_students(id,org_id,parent_id,student_id,student_code,created_at,updated_at) VALUES('ps1','MT1967','p1','STU1','STU1',?,?)`).bind(new Date().toISOString(),new Date().toISOString()).run();
let r=await communications.sendStudentReportEmail({studentId:'STU1',email:'ignored@example.com'},auth,env); assert.equal(r.success,true); assert.equal(r.channel,'PUSH');
let push=await db.prepare(`SELECT owner_type,owner_id,data_json FROM push_notifications ORDER BY created_at DESC LIMIT 1`).first(); assert.equal(push.owner_type,'parent'); assert.equal(push.owner_id,'p1'); assert.match(push.data_json,/ACADEMIC_REPORT/);

r=await updateStudentPortalUrl({url:'https://portal.example.test'},auth,env); assert.equal(r.success,true);
r=await saveUserTheme({theme:{mode:'dark'}},auth,env); assert.equal(r.success,true);
r=await updateMyProfilePhoto({photo:'data:image/png;base64,AAAA'},auth,env); assert.equal(r.success,true); assert.equal(r.photo,'data:image/png;base64,AAAA');
let row=await db.prepare(`SELECT photo_url FROM users WHERE id='u1'`).first(); assert.equal(row.photo_url,'data:image/png;base64,AAAA');
const objects=new Map(); const mediaBucket={async put(key,bytes,opts){objects.set(key,{bytes:new Uint8Array(bytes),opts});}};
const r2Env={...env,MEDIA_BUCKET:mediaBucket,PUBLIC_BASE_URL:'https://ecole.eduflow.win'};
r=await updateMyProfilePhoto({photo:'data:image/png;base64,AAAA'},auth,r2Env); assert.equal(r.success,true); assert.equal(r.storage,'r2'); assert.match(r.photo,/^https:\/\/ecole\.eduflow\.win\/media\/profile-photos\/MT1967\/u1-/);
row=await db.prepare(`SELECT photo_url FROM users WHERE id='u1'`).first(); assert.equal(row.photo_url,r.photo);
r=await uploadLogoToDriveSecure({base64Data:'data:image/png;base64,AAAA',mimeType:'image/png',fileName:'logo.png'},auth,env); assert.equal(r.success,false); assert.match(r.error,/MEDIA_BUCKET/);
r=await clearMeigensConfiguration({},auth,env); assert.equal(r.success,true);
console.log('legacy communication/settings tests passed');
