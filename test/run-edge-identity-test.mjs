import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-id-'));
const port = 19000 + Math.floor(Math.random()*500);
const token='test-token-0040';
const fp=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
await fs.writeFile(path.join(dir,'identity-cache.json'), JSON.stringify({version:1,siteId:'SITE-LOCAL',edgeId:'EDGE-SITE-LOCAL',entries:{[fp]:{userId:'u1',email:'u1@example.test',role:'Enseignant',active:true,permissions:{pt_view_attendance:true},isTeacher:true,assignedSubjects:{},isMaster:false,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));
const edge = spawn(process.execPath, ['edge/eduhaiti-edge.mjs'], { cwd: process.cwd(), env: {...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_CLOUD_URL:'', EDU_EDGE_DATA_DIR:dir}, stdio:['ignore','pipe','pipe'] });
const base=`http://127.0.0.1:${port}`;
let ready=false;
for(let i=0;i<50;i++){ try{ const r=await fetch(base+'/edge/health'); if(r.ok){ready=true;break;} }catch{} await new Promise(r=>setTimeout(r,100)); }
assert.equal(ready,true);
const reg=await fetch(base+'/edge/devices/register',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'X-Eduhaiti-Device-Id':'device-0040'},body:JSON.stringify({deviceId:'device-0040'})});
assert.equal(reg.status,200);
const ok=await fetch(base+'/edge/local-api?action=getAttendance',{headers:{Authorization:'Bearer '+token,'X-Eduhaiti-Device-Id':'device-0040'}});
assert.equal(ok.status,200);
const denied=await fetch(base+'/edge/local-api?action=getPayments',{headers:{Authorization:'Bearer '+token,'X-Eduhaiti-Device-Id':'device-0040'}});
assert.equal(denied.status,403);
const absent=await fetch(base+'/edge/local-api?action=getAttendance',{headers:{Authorization:'Bearer wrong'}});
assert.equal(absent.status,401);
edge.kill('SIGTERM');
console.log('edge identity offline auth/permissions: PASS');
