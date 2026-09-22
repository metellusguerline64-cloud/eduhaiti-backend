import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-bi-'));
const port = 19500 + Math.floor(Math.random()*300);
const token='bidirectional-token-0041';
const fp=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
await fs.writeFile(path.join(dir,'identity-cache.json'), JSON.stringify({version:1,siteId:'SITE-LOCAL',edgeId:'EDGE-SITE-LOCAL',entries:{[fp]:{userId:'u1',email:'u1@example.test',role:'Admin',active:true,permissions:{p_dossier:true},isTeacher:false,assignedSubjects:{},isMaster:false,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));
const edge = spawn(process.execPath, ['edge/eduhaiti-edge.mjs'], { cwd: process.cwd(), env: {...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_CLOUD_URL:'', EDU_EDGE_DATA_DIR:dir, EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'false'}, stdio:['ignore','pipe','pipe'] });
const base=`http://127.0.0.1:${port}`;
try {
  let ready=false;
  for(let i=0;i<50;i++){ try{ const r=await fetch(base+'/edge/health'); if(r.ok){ready=true;break;} }catch{} await new Promise(r=>setTimeout(r,100)); }
  assert.equal(ready,true);
  const entry={id:'ST-0041',table:'students',op:'upsert',baseVersion:0,fields:{student_code:'ST-0041',first_name:'Test',last_name:'Offline',active:1},idempotencyKey:'idem-0041-1'};
  const body={action:'syncPush',data:{token,deviceId:'device-0041',entries:[entry]}};
  const first=await fetch(base+'/?action=syncPush',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal(first.status,200);
  const firstBody=await first.json();
  assert.equal(firstBody.success,true);
  assert.equal(firstBody.edgeQueued,true);
  const second=await fetch(base+'/?action=syncPush',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  assert.equal(second.status,200);
  const secondBody=await second.json();
  assert.equal(secondBody.success,true);
  assert.equal(secondBody.edgeQueued,true);
  const status=await fetch(base+'/edge/sync-status?deviceId=device-0041');
  const statusBody=await status.json();
  assert.equal(statusBody.success,true);
  assert.equal(statusBody.items.length,1);
  assert.equal(statusBody.items[0].status,'pending');
  const local=await fetch(base+'/edge/local-api?action=getStudents',{headers:{Authorization:'Bearer '+token,'X-Eduhaiti-Device-Id':'device-0041'}});
  assert.equal(local.status,200);
  const localBody=await local.json();
  assert.equal(localBody.data.some(x=>x.StudentCode==='ST-0041'),true);
  console.log('edge bidirectional offline queue + local read reconciliation: PASS');
} finally { edge.kill('SIGTERM'); }
