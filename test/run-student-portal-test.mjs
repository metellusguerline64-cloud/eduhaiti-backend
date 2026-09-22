import assert from 'node:assert/strict';
import { studentPortalLogin, setupInitialPin, getActiveEnrollment, getEnrollmentsByClass, verifyStudentByLast4 } from '../src/actions/student_portal.js';
import { registerBulletinIssue, verifyBulletin } from '../src/actions/bulletin_verification.js';
import { actions } from '../src/actions/index.js';

class DB { constructor(){this.students=[];this.settings=[{key:'ORG_ID',value:'ORG1'},{key:'STUDENT_ID_PREFIX',value:'MT'}];this.history=[];this.b=[];this.sessions=[];} prepare(sql){const self=this; return {first:async()=>self.first(sql,[]),bind(...args){return {first:async()=>self.first(sql,args),all:async()=>({results:self.all(sql,args)}),run:async()=>self.run(sql,args)}}}} first(sql,a){if(sql.includes('SELECT value FROM settings')) return this.settings.find(x=>x.key===(a[0]||'STUDENT_ID_PREFIX'))||null;if(sql.includes('FROM students')) return this.students.find(r=>r.org_id===a[0]&&(r.student_code===a[1]||r.id===a[1]))||null;if(sql.includes('FROM student_history')) return this.history.filter(r=>r.org_id===a[0]&&r.student_id===a[1]).sort((x,y)=>y.updated_at.localeCompare(x.updated_at))[0]||null;if(sql.includes('FROM bulletin_verifications')) return this.b.find(r=>r.org_id===a[0]&&r.verify_id===a[1])||null;return null} all(sql,a){if(sql.includes('SELECT value FROM settings')) return this.settings;if(sql.includes('ROW_NUMBER() OVER')) return this.students.filter(r=>r.org_id===a[1]).map(r=>{const h=this.history.filter(x=>x.org_id===a[0]&&x.student_id===r.student_code).sort((x,y)=>y.updated_at.localeCompare(x.updated_at))[0]||{};return {...r,history_id:h.history_id,grade_level_id:h.grade_level_id,history_section:h.section,school_year:h.school_year,history_status:h.status};});
if(sql.includes('FROM students')) return this.students.filter(r=>r.org_id===a[0]);if(sql.includes('FROM student_history')) return this.history.filter(r=>r.org_id===a[0]);if(sql.includes('FROM bulletin_verifications')) return this.b.filter(r=>r.org_id===a[0]);return []} async run(sql,a){return {success:true}}}
const env={DB:new DB(),ORG_ID:'ORG1'}; env.DB.students.push({id:'uuid1',student_code:'MT0001',org_id:'ORG1',first_name:'Jean',last_name:'Test',phone:'50934133434',active:1,pin_hash:'',custom_fields:JSON.stringify({parentPhone:'50934133434'})});
env.DB.history.push({history_id:'H1',student_id:'MT0001',org_id:'ORG1',school_year:'2026-2027',grade_level_id:'NS1',section:'A',status:'ACTIVE',updated_at:'2026-09-01'});
assert.equal((await studentPortalLogin({studentCode:'MT0001',pin:'34133434'},null,env)).firstTime,true);
const setup=await setupInitialPin({id:'MT0001',pin:'1234'},null,env); assert.equal(setup.success,true);
env.DB.students[0].pin_hash=await (await import('../src/lib/hash.js')).hashPin('1234');
assert.equal((await studentPortalLogin({studentCode:'MT0001',pin:'1234'},null,env)).success,true);
assert.equal((await getActiveEnrollment({studentId:'MT0001'},null,env)).data.gradeLevel,'NS1');
assert.equal((await getEnrollmentsByClass({classId:'NS1'},null,env)).count,1);
assert.equal((await verifyStudentByLast4({query:'Jean'},null,env)).found,true);
// registry contract; bulletin DB mutation behavior is covered by integration tests when D1 is available.
for (const n of ['studentPortalLogin','setupInitialPin','getActiveEnrollment','getEnrollmentsByClass','verifyStudentByLast4','registerBulletinIssue','verifyBulletin']) assert.equal(typeof actions[n],'function',n);
console.log('0063 student portal registry/test: PASS');
