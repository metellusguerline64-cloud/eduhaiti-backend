import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { typedDeltaPull, applyTypedOutboxBatch } from '../src/lib/typedSync.js';

const DB_PATH='/tmp/eduhaiti-typed-sync.sqlite';
try { fs.unlinkSync(DB_PATH); } catch {}
const db=makeD1(DB_PATH);
db._raw.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url),'utf8'));
db._raw.prepare("INSERT INTO settings(key,value) VALUES('ORG_ID','ORG1')").run();

const common={orgId:'ORG1',userId:'U1',deviceId:'D1'};
const student={id:'STU-LOCAL-1',student_code:'STU-100',first_name:'Jean',last_name:'Pierre',section:'A',active:true,custom_fields:{foo:'bar'}};
let r=await applyTypedOutboxBatch(db,[{idempotencyKey:'k1',table:'students',op:'upsert',id:student.id,baseVersion:0,fields:student}],common);
console.assert(r[0].status==='applied' && r[0].version===1,'student insert failed',r);

r=await applyTypedOutboxBatch(db,[{idempotencyKey:'k1',table:'students',op:'upsert',id:student.id,baseVersion:0,fields:student}],common);
console.assert(r[0].status==='already_applied','idempotency failed',r);

const pulled=await typedDeltaPull(db,'students','ORG1','1970-01-01T00:00:00.000Z');
console.assert(pulled.rows.length===1 && pulled.rows[0].fields.student_code==='STU-100','delta pull failed',pulled);

r=await applyTypedOutboxBatch(db,[{idempotencyKey:'g1',table:'grades',op:'upsert',id:'GRD-1',baseVersion:0,fields:{student_id:'STU-100',subject_id:'MATH',score:15,scores_json:{T1:15}}}],common);
console.assert(r[0].status==='applied','grade insert failed',r);
r=await applyTypedOutboxBatch(db,[{idempotencyKey:'g2',table:'grades',op:'upsert',id:'GRD-1',baseVersion:0,fields:{student_id:'STU-100',subject_id:'MATH',score:17,scores_json:{T1:17}}}],common);
console.assert(r[0].status==='conflict','strict grade conflict failed',r);

r=await applyTypedOutboxBatch(db,[{idempotencyKey:'d1',table:'grades',op:'delete',id:'GRD-1',baseVersion:1,fields:{}}],common);
console.assert(r[0].status==='applied','grade delete failed',r);
console.log('All typed sync assertions passed.');

// Offline multi-device attendance: same student/day + same status is collapsed;
// same student/day + different status is surfaced as a conflict.
const attA={id:'ATT-DEVICE-A-1',table:'attendance',op:'upsert',baseVersion:0,idempotencyKey:'att-a-1',fields:{student_id:'STU-100',grade_level_id:'7A',date:'2026-09-16',status:'PRESENT',recorded_by:'teacher-a',meta_json:{deviceId:'DEVICE-A',recordedAtLocal:'2026-09-16T08:00:01-04:00'}}};
r=await applyTypedOutboxBatch(db,[attA],{orgId:'ORG1',userId:'UA',deviceId:'DEVICE-A'});
console.assert(r[0].status==='applied','attendance device A insert failed',r);

const attBsame={...attA,id:'ATT-DEVICE-B-1',idempotencyKey:'att-b-same',fields:{...attA.fields,recorded_by:'teacher-b',meta_json:{deviceId:'DEVICE-B',recordedAtLocal:'2026-09-16T08:00:02-04:00'}}};
r=await applyTypedOutboxBatch(db,[attBsame],{orgId:'ORG1',userId:'UB',deviceId:'DEVICE-B'});
console.assert(r[0].status==='duplicate' && r[0].canonicalId===attA.id,'same-status attendance duplicate was not collapsed',r);

const attBdiff={...attA,id:'ATT-DEVICE-B-2',idempotencyKey:'att-b-diff',fields:{...attA.fields,status:'ABSENT',recorded_by:'teacher-b',meta_json:{deviceId:'DEVICE-B',recordedAtLocal:'2026-09-16T08:00:03-04:00'}}};
r=await applyTypedOutboxBatch(db,[attBdiff],{orgId:'ORG1',userId:'UB',deviceId:'DEVICE-B'});
console.assert(r[0].status==='conflict' && r[0].serverStatus==='PRESENT','different-status attendance conflict was not detected',r);
const attRows=db._raw.prepare("SELECT id,status FROM attendance WHERE org_id='ORG1' AND student_id='STU-100' AND date='2026-09-16' AND deleted_at IS NULL").all();
console.assert(attRows.length===1 && attRows[0].id===attA.id,'attendance duplicate row was created',attRows);
