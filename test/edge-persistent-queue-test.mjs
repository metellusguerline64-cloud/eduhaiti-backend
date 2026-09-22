import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-'));
const port = 18787 + Math.floor(Math.random()*500);
const script = path.resolve('edge/eduhaiti-edge.mjs');
const child = spawn(process.execPath, [script], { env:{...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_SITE_ID:'TEST-SITE', EDU_EDGE_ID:'EDGE-TEST-01', EDU_EDGE_CLOUD_URL:'http://127.0.0.1:9/api', EDU_EDGE_DATA_DIR:dir, EDU_EDGE_REQUIRE_OFFLINE_AUTH:'false', EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'false' }, stdio:['ignore','pipe','pipe'] });
try {
  let ready=false;
  for(let i=0;i<50;i++){
    try{ const r=await fetch(`http://127.0.0.1:${port}/edge/health`); if(r.ok){ready=true;break;} }catch(_){ await new Promise(r=>setTimeout(r,50)); }
  }
  assert.equal(ready,true,'Edge ne démarre pas');
  const body={action:'syncPush',data:{token:'test-token',deviceId:'device-test',entries:[{idempotencyKey:'idem-1',table:'students',op:'upsert',id:'stu-1',fields:{name:'Test'}}]}};
  const r=await fetch(`http://127.0.0.1:${port}/api/?action=syncPush`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer test-token'},body:JSON.stringify(body)});
  const j=await r.json();
  assert.equal(j.success,true);
  assert.equal(j.edgeQueued,true);
  assert.equal(j.outcomes[0].status,'queued');
  const q=await (await fetch(`http://127.0.0.1:${port}/edge/queue`)).json();
  assert.equal(q.pending,1);
  assert.equal(q.items[0].deviceId,'device-test');
  const localPull = await fetch(`http://127.0.0.1:${port}/api/?action=syncPull&table=students&limit=500`, {headers:{'Authorization':'Bearer test-token'}});
  const localJson = await localPull.json();
  assert.equal(localJson.success,true);
  assert.equal(localJson.edgeServed,true);
  assert.equal(localJson.stale,true);
  assert.equal(localJson.rows[0].id,'stu-1');
  assert.equal(localJson.rows[0].name,'Test');
  const ds = await (await fetch(`http://127.0.0.1:${port}/edge/data-status`)).json();
  assert.equal(ds.success,true);
  assert.equal(ds.tables.students,1);
  console.log('PASS edge-persistent-queue-test');
} finally {
  child.kill('SIGTERM');
  await fs.rm(dir,{recursive:true,force:true});
}
