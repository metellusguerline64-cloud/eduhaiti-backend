import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1 } from './d1shim.mjs';
import { storeSessionToken } from '../src/lib/session.js';
import { getAllAdminUsers, updateUserRoleAndPerms, resetUserPassword, toggleGodMode } from '../src/actions/users.js';
const dbPath=path.join(os.tmpdir(),'eduhaiti-users-test.sqlite'); try{fs.unlinkSync(dbPath)}catch{}
const db=makeD1(dbPath); db._raw.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8')); db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','ORG1')`).run();
const adminId=crypto.randomUUID(); db._raw.prepare(`INSERT INTO users(id,user_id,email,name,role,password_hash,active,is_master,permissions_json) VALUES(?,?,?,?,?,?,?,?,?)`).run(adminId,'ADM1','admin@school.ht','Admin','ADMIN','x',1,1,JSON.stringify({pa_manage_users:true,p_staff:true}));
await storeSessionToken(db,'adm-token',{userId:adminId,email:'admin@school.ht',role:'ADMIN'}); const auth={token:'adm-token'}; const env={DB:db,ORG_ID:'ORG1'};
const created=await updateUserRoleAndPerms({name:'Teacher One',email:'teacher@school.ht',role:'Teacher',isTeacher:true,assignments:{classes:['6EME']},perms:{pt_view_student_profile:true},password:'654321'},auth,env); console.assert(created.success,'create user',created);
const list=await getAllAdminUsers({},auth,env); console.assert(list.length===2 && list.some(x=>x.email==='teacher@school.ht' && x.isTeacher),'list users',list);
const reset=await resetUserPassword({email:'teacher@school.ht'},auth,env); console.assert(reset.success && reset.defaultPassword==='123456','reset',reset);
const gm=await toggleGodMode({email:'teacher@school.ht'},auth,env); console.assert(gm.success && gm.godmodeEnabled===true,'godmode',gm);
console.log('users tests passed');
