import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { checkAndUpdateAccountStatus } from '../src/actions/legacy_batch_0068.js';

const tenant = makeD1(':memory:');
tenant._raw.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
tenant._raw.prepare(`INSERT INTO users (id,user_id,email,name,role,password_hash,permissions_json,active) VALUES (?,?,?,?,?,?,?,1)`).run('admin','A1','admin@test','Admin','ADMIN','hash','{"pa_save_settings":true}');
tenant._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES (?,?,?,?,?)`).run('sess','admin','admin@test','{"userId":"admin","email":"admin@test"}',new Date(Date.now()+3600000).toISOString());
const master = makeD1(':memory:');
master._raw.exec(fs.readFileSync(new URL('../master-schema.sql', import.meta.url), 'utf8'));
const now = Date.now();
const iso = new Date(now + 86400000).toISOString();
const expired = new Date(now - 86400000).toISOString();
master._raw.prepare(`INSERT INTO orgs(id,business_id,pin_hash,org_type,business_name,email,subdomain,reg_token,plan,status,expiration_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('o1','MT1001','x','SCHOOL','Active School','a@test','active-school','r1','PRO','ACTIVE',iso);
master._raw.prepare(`INSERT INTO orgs(id,business_id,pin_hash,org_type,business_name,email,subdomain,reg_token,plan,status,expiration_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('o2','MT1002','x','SCHOOL','Expired School','b@test','expired-school','r2','PRO','ACTIVE',expired);
master._raw.prepare(`INSERT INTO orgs(id,business_id,pin_hash,org_type,business_name,email,subdomain,reg_token,plan,status,expiration_date) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('o3','MT1003','x','SCHOOL','Lifetime School','c@test','lifetime-school','r3','LIFETIME','SUSPENDED',expired);
const env={DB:tenant,MASTER_DB:master};

console.log('=== single account sync ===');
const one=await checkAndUpdateAccountStatus({businessId:'MT1002'}, {token:'sess'}, env);
console.assert(one.success===true && one.reviewed===1 && one.changed===1 && one.data[0].nextStatus==='SUSPENDED','Expired account should suspend',one);

console.log('=== all accounts requires master ===');
const allDenied=await checkAndUpdateAccountStatus({all:true},{token:'sess'},env);
console.assert(allDenied.success===false,'Non-master must not sync all accounts',allDenied);

console.log('=== lifetime and valid accounts remain active ===');
// This fixture has pa_save_settings, but not master, so use a direct status call per org.
const lifetime=await checkAndUpdateAccountStatus({subdomain:'lifetime-school'},{token:'sess'},env);
console.assert(lifetime.success===true && lifetime.data[0].nextStatus==='ACTIVE' && lifetime.data[0].reason==='LIFETIME_PLAN','Lifetime plan should activate',lifetime);
const valid=await checkAndUpdateAccountStatus({subdomain:'active-school'},{token:'sess'},env);
console.assert(valid.success===true && valid.data[0].nextStatus==='ACTIVE','Valid account should stay active',valid);

console.log('All account-status assertions passed.');
