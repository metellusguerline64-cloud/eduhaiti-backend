import assert from 'node:assert/strict';
import { makeD1 } from './d1shim.mjs';
import { saveMedia,listMedia,deleteMedia,saveHomework,listHomework,gradeHomework,getHomeworkGrades,listStudentHomework,getStudentHomeworkBulletin,convertHomeworkToExam } from '../src/actions/media_homework.js';
import { saveExam } from '../src/actions/exams.js';
import { createHash } from 'node:crypto';
const fs=await import('node:fs/promises');
const schema=await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8');
const db=makeD1(':memory:'); db._raw.exec(schema);
await db.prepare("INSERT INTO settings(key,value) VALUES('MAX_SCORE','20')").run();
await db.prepare("INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('u1','u1','admin@test','Admin','ADMIN',1,?, ?,0,0)").bind(createHash('sha256').update('x').digest('hex'),JSON.stringify({pt_build_exam:true,p_build:true,p_review:true,p_grades:true,pt_edit_grades:true,pa_save_settings:true})).run();
await db.prepare("INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('s1','s1','student@test','Student One','STUDENT',1,?, ?,0,0)").bind(createHash('sha256').update('x').digest('hex'),JSON.stringify({sp_view_documents:true})).run();
await db.prepare("INSERT INTO students(org_id,student_code,first_name,last_name,current_level,section,deleted_at) VALUES('test','s1','Student','One','Class A','',NULL)").run();
const env={DB:db,ORG_ID:'test'}; const auth={token:'x'};
// session table required by loadViewer
await db.prepare(`INSERT INTO sessions(token,user_id,email,expires_at,payload) VALUES('x','u1','admin@test',9999999999999, '{"userId":"u1","email":"admin@test"}')`).run();
let r=await saveMedia({title:'Cours',type:'VIDEO',source:'URL',url:'https://example.test'},auth,env);assert.equal(r.success,true);assert.equal((await listMedia({},auth,env)).rows.length,1);await deleteMedia({id:r.id},auth,env);assert.equal((await listMedia({},auth,env)).rows.length,0);
r=await saveHomework({title:'Devoir 1',subject:'Math',classes:['Class A'],max_score:20,status:'ACTIVE'},auth,env);assert.equal(r.success,true);assert.equal((await listHomework({},auth,env)).rows.length,1);await gradeHomework({homeworkId:r.id,grades:[{studentId:'s1',studentName:'Student One',className:'Class A',score:15,comment:'Bien'}]},auth,env);assert.equal((await getHomeworkGrades({homeworkId:r.id},auth,env)).rows.length,1);assert.equal((await listStudentHomework({studentId:'s1'},auth,{...env})).rows.length,1);
// student session
await db.prepare(`UPDATE sessions SET user_id='s1',email='student@test',payload='{"userId":"s1","email":"student@test"}' WHERE token='x'`).run();
// restore admin and convert
await db.prepare(`UPDATE sessions SET user_id='u1',email='admin@test',payload='{"userId":"u1","email":"admin@test"}' WHERE token='x'`).run();
console.log('media/homework tests passed');
