import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { actions } from '../src/actions/index.js';
import { storeSessionToken } from '../src/lib/session.js';

const f='/tmp/legacy-quiz-maternal-test.sqlite';
for(const x of [f,f+'-shm',f+'-wal']){try{fs.unlinkSync(x)}catch{}}
const db=makeD1(f);
db._raw.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
db._raw.exec(fs.readFileSync(new URL('../migrations/0021_legacy_quiz_maternal.sql',import.meta.url),'utf8'));
const env={DB:db,ORG_ID:'default'};

await db.prepare(`INSERT INTO users(id,user_id,email,name,password_hash,role,active,permissions_json,is_master,is_god_mode) VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .bind('admin','admin','admin@x','Admin','x','ADMIN',1,JSON.stringify({p_manual:true,p_review:true,pa_save_settings:true,p_grades:true}),0,0).run();
await storeSessionToken(db,'ta',{userId:'admin',email:'admin@x'},86400000);

let r=await actions.addQuizQuestion({exam:'Faith',text:'What is faith?',options:['A','B','C'],correct:'A',points:7,type:'mcq'},{token:'ta'},env);
assert.equal(r.success,true);
r=await actions.getQuizQuestions({examTitle:'Faith'},{token:'ta'},env);
assert.equal(r.length,1); assert.deepEqual(r[0],{text:'What is faith?',options:['A','B','C'],correct:'A',points:7,type:'mcq'});
r=await actions.updateExamSettings({ExamTitle:'Faith',AcceptResponses:true,DueDate:'2026-10-01'},{token:'ta'},env);
assert.equal(r.success,true);
const setting=await db.prepare(`SELECT value FROM settings WHERE key=?`).bind('EXAM_SETTINGS_Faith').first();
assert.deepEqual(JSON.parse(setting.value),{ExamTitle:'Faith',AcceptResponses:true,DueDate:'2026-10-01'});

await db.prepare(`INSERT INTO grades(id,org_id,history_id,student_id,grade_level_id,subject_id,period_id,score,mention,teacher_id,scores_json,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
 .bind('g1','default','h1','S1','6e','Math','T1',80,'','','{}','2026-01-01','2026-01-01').run();
r=await actions.getAvailableExams({}, {token:'ta'}, env); assert.deepEqual(r,[{title:'Math'}]);

r=await actions.saveMaternalCurriculumCheck({classKey:'PETITS',rowKey:'langue|couleurs',period:'t1',mention:'Acquis'},{token:'ta'},env);
assert.equal(r.success,true);
r=await actions.getMaternalCurriculumChecks({classKey:'PETITS'},{token:'ta'},env);
assert.deepEqual(r,{success:true,data:{'langue|couleurs':{T1:'Acquis'}}});
r=await actions.saveMaternalCurriculumCheck({classKey:'PETITS',rowKey:'langue|couleurs',period:'T1',mention:''},{token:'ta'},env);
assert.equal(r.success,true);
r=await actions.getMaternalCurriculumChecks({classKey:'PETITS'},{token:'ta'},env);
assert.deepEqual(r,{success:true,data:{}});

console.log('legacy quiz + maternal tests passed');
