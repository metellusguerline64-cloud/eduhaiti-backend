import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { makeD1 } from './d1shim.mjs';
import { storeSessionToken } from '../src/lib/session.js';
import { getSaaSSettings } from '../src/actions/settings.js';

const schema=await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8');
const db=makeD1(':memory:'); db._raw.exec(schema);
const env={DB:db,ORG_ID:'ORG-HIST'};
await db.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('u1','u1','admin@test','Admin','ADMIN',1,'x','{"p_settings":true}',0,0)`).run();
await storeSessionToken(db,'tok',{userId:'u1',email:'admin@test'},3600);
await db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('SCHOOL_NAME','École Actuelle','2026-08-01T00:00:00Z'),('ACADEMIC_YEAR','2026-2027','2026-08-01T00:00:00Z')`).run();
const snap=JSON.stringify({settings:[{key:'SCHOOL_NAME',value:'École 2025',updated_at:'2025-08-01T00:00:00Z'},{key:'ACADEMIC_YEAR',value:'2025-2026',updated_at:'2025-08-01T00:00:00Z'}]});
await db.prepare(`INSERT INTO academic_year_archives(id,org_id,year,next_year,closed_at,closed_by,snapshot_json,version,updated_at,deleted_at) VALUES('AY1','ORG-HIST','2025-2026','2026-2027','2026-07-01T00:00:00Z','admin@test',?,1,'2026-07-01T00:00:00Z',NULL)`).bind(snap).run();
let r=await getSaaSSettings({targetYear:'2025-2026'},{token:'tok'},env);
assert.equal(r.success,true); assert.equal(r.data.schoolName,'École 2025'); assert.equal(r.data.ACADEMIC_YEAR,'2025-2026');
r=await getSaaSSettings({}, {token:'tok'}, env); assert.equal(r.data.schoolName,'École Actuelle');
console.log('settings historical tests passed');
