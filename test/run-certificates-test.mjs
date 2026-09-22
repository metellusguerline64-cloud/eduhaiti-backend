import assert from 'node:assert/strict';
import { issueCertificate, listCertificates, getCertificate, revokeCertificate, verifyCertificate, getCertificatePrintHtml } from '../src/actions/certificates.js';
import { makeD1 } from './d1shim.mjs';
import fs from 'node:fs';
import { storeSessionToken } from '../src/lib/session.js';

const db = makeD1(':memory:');
const env = { DB: db };
const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url),'utf8');
db._raw.exec(schema);
db._raw.exec(fs.readFileSync(new URL('../migrations/0015_certificates.sql', import.meta.url),'utf8'));
await db.prepare(`INSERT INTO students(id,student_code,org_id,first_name,last_name,current_level,section,enrollment_status,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind('s1','STU-001','org1','Jean','Dupont','NS4','A','ACTIVE',1).run();
await db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)`).bind('SCHOOL_NAME',JSON.stringify('École Test')).run();
const auth={token:'t',email:'admin@test.local',userId:'u1'};
// resolveOrgId reads env.ORG_ID in the tenant-scoped Worker.
env.ORG_ID='org1';
await storeSessionToken(db,'t',{userId:'u1',email:'admin@test.local'},3600);
await db.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind('u1','u1','admin@test.local','Admin','ADMIN',1,'x',JSON.stringify({pa_generate_report:true,p_dossier:true,pt_view_bulletin:true,pt_export_data:true}),1,0).run();
const issued=await issueCertificate({studentId:'STU-001',title:'Certificat de réussite',description:'Décerné pour réussite scolaire.',schoolYear:'2025-2026'},auth,env);
assert.equal(issued.success,true);
const v=await verifyCertificate({verificationToken:issued.certificate.verificationToken},null,env);
assert.equal(v.success,true); assert.equal(v.verified,true); assert.equal(v.certificate.studentName,'Jean Dupont');
const list=await listCertificates({},auth,env); assert.equal(list.rows.length,1);
const got=await getCertificate({id:issued.certificate.id},auth,env); assert.equal(got.success,true);
const html=await getCertificatePrintHtml({id:issued.certificate.id},auth,env); assert.equal(html.success,true); assert.match(html.html,/Certificat de réussite/);
const revoked=await revokeCertificate({id:issued.certificate.id},auth,env); assert.equal(revoked.success,true);
const v2=await verifyCertificate({verificationToken:issued.certificate.verificationToken},null,env); assert.equal(v2.verified,false);
console.log('Certificates tests passed.');
