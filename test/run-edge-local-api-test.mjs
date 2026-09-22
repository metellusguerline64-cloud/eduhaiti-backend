import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'eduhaiti-edge-'));
const port = 18878 + Math.floor(Math.random()*200);
const env = { ...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_HOST:'127.0.0.1', EDU_EDGE_SITE_ID:'TEST-SITE', EDU_EDGE_ID:'EDGE-TEST-01', EDU_EDGE_DATA_DIR:dir, EDU_EDGE_CLOUD_URL:'', EDU_EDGE_REQUIRE_OFFLINE_AUTH:'false', EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'false' };
const child = spawn(process.execPath, ['edge/eduhaiti-edge.mjs'], { cwd: ROOT, env, stdio:['ignore','pipe','pipe'] });
let output=''; child.stdout.on('data',d=>output+=d); child.stderr.on('data',d=>output+=d);
const base=`http://127.0.0.1:${port}`;
async function wait(){ for(let i=0;i<50;i++){ try{ const r=await fetch(base+'/edge/health'); if(r.ok) return; }catch{} await new Promise(r=>setTimeout(r,100)); } throw new Error('Edge did not start\n'+output); }
try {
  await wait();
  const health = await (await fetch(base+'/edge/health')).json();
  if (!health.success || health.siteId !== 'TEST-SITE') throw new Error('health failed');
  const discovery = await (await fetch(base+'/edge/discovery')).json();
  if (discovery.edgeId !== 'EDGE-TEST-01') throw new Error('discovery failed');
  const entry = { id:'student-local-1', table:'students', op:'upsert', baseVersion:0, idempotencyKey:'test-key-1', fields:{firstName:'Local',lastName:'Student'}, };
  const push = await (await fetch(base+'/?action=syncPush',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer test'},body:JSON.stringify({action:'syncPush',data:{token:'test',deviceId:'device-test',entries:[entry]}})})).json();
  if (!push.success || !push.edgeQueued) throw new Error('syncPush was not queued');
  const pull = await (await fetch(base+'/?action=syncPull&table=students&token=test&limit=500')).json();
  if (!pull.success || !pull.rows.some(r=>r.id==='student-local-1')) throw new Error('local syncPull failed');
  const status = await (await fetch(base+'/edge/data-status')).json();
  if (!status.success || status.tables.students !== 1) throw new Error('data-status failed');
  console.log('PASS edge local API: discovery + persistent queue + local syncPull + data status');
} finally {
  child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,100)); await rm(dir,{recursive:true,force:true});
}
