import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { makeD1 } from './d1shim.mjs'; import { storeSessionToken } from '../src/lib/session.js';
import { updateUserRoleAndPerms, toggleUserActiveState, removeUserAccess, resetUserPassword, toggleGodMode } from '../src/actions/users.js';
const dbPath=path.join(os.tmpdir(),'eduhaiti-users-hardening.sqlite'); try{fs.unlinkSync(dbPath)}catch{}
const db=makeD1(dbPath); db._raw.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8')); db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','ORG1')`).run();
const admin=crypto.randomUUID(); db._raw.prepare(`INSERT INTO users(id,user_id,email,name,role,password_hash,active,is_master,permissions_json) VALUES(?,?,?,?,?,?,?,?,?)`).run(admin,'ADM1','admin@school.ht','Admin','ADMIN','x',1,1,JSON.stringify({pa_manage_users:true,p_staff:true})); await storeSessionToken(db,'adm-hard',{userId:admin,email:'admin@school.ht',role:'ADMIN'}); const auth={token:'adm-hard'}; const env={DB:db,ORG_ID:'ORG1'};
let r=await updateUserRoleAndPerms({name:'G',email:'god@school.ht',role:'Staff',perms:{isGodMode:true},password:'111111'},auth,env); console.assert(r.success,'create god');
let g=await toggleGodMode({email:'god@school.ht'},auth,env); console.assert(g.success && g.godmodeEnabled===false,'toggle off');
r=await updateUserRoleAndPerms({userId:'MT'+String(2).padStart(4,'0'),name:'New',email:'new@school.ht',perms:{pa_manage_users:true}},auth,env); console.assert(r.success,'create second');
let row=db._raw.prepare(`SELECT * FROM users WHERE email=?`).get('new@school.ht'); console.assert(row.reset_required===1,'new user reset flag');
let t=await toggleUserActiveState({email:'new@school.ht',active:false},auth,env); console.assert(t.success && t.active===false,'deactivate'); row=db._raw.prepare(`SELECT active FROM users WHERE email=?`).get('new@school.ht'); console.assert(row.active===0,'db inactive');
let rr=await resetUserPassword({email:'new@school.ht'},auth,env); console.assert(rr.success && rr.defaultPassword==='123456','reset');
let rm=await removeUserAccess({email:'new@school.ht'},auth,env); console.assert(rm.success,'remove'); row=db._raw.prepare(`SELECT deleted_at,active FROM users WHERE email=?`).get('new@school.ht'); console.assert(row.deleted_at && row.active===0,'soft delete');
console.log('users hardening parity tests passed');
