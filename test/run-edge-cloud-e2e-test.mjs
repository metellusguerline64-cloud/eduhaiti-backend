import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const edgeScript = path.join(root, 'edge/eduhaiti-edge.mjs');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-e2e-'));
const edgePort = 19600 + Math.floor(Math.random() * 300);
const cloudPort = edgePort + 1;
const token = 'e2e-token-0056';
const deviceId = 'E2E-DEVICE-0056';
const cloud = new Map();
const cloudOps = new Set();

function cloudJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks=[];
    req.on('data', c=>chunks.push(c));
    req.on('end', ()=>resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const cloudServer = http.createServer(async (req,res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.searchParams.get('action') === 'syncPush' && req.method === 'POST') {
      const payload = JSON.parse(await readBody(req) || '{}');
      const entries = payload?.data?.entries || [];
      const outcomes=[];
      for (const e of entries) {
        if (cloudOps.has(e.idempotencyKey)) {
          const row=cloud.get(`${e.table}:${e.id}`);
          outcomes.push({idempotencyKey:e.idempotencyKey,status:'already_applied',id:e.id,table:e.table,version:row?.version,updatedAt:row?.updatedAt});
          continue;
        }
        const key=`${e.table}:${e.id}`;
        const previous=cloud.get(key);
        const updatedAt=new Date().toISOString();
        const row={id:String(e.id), table:e.table, fields:{...(e.fields||{})}, version:(previous?.version||0)+1, updatedAt, deletedAt:e.op==='delete'?updatedAt:null};
        cloud.set(key,row);
        cloudOps.add(e.idempotencyKey);
        outcomes.push({idempotencyKey:e.idempotencyKey,status:'applied',id:e.id,table:e.table,version:row.version,updatedAt});
      }
      return cloudJson(res,200,{success:true,outcomes,cloudAuthority:true});
    }
    if (u.searchParams.get('action') === 'syncPull' && req.method === 'GET') {
      const table=u.searchParams.get('table');
      const cursor=u.searchParams.get('cursor') || '';
      const rows=[...cloud.values()].filter(r=>r.table===table && r.updatedAt>cursor).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt));
      const nextCursor=rows.length ? rows.at(-1).updatedAt : cursor;
      return cloudJson(res,200,{success:true,table,rows,cursor:nextCursor,hasMore:false,cloudAuthority:true});
    }
    return cloudJson(res,404,{success:false,error:'unknown test cloud route'});
  } catch (e) { return cloudJson(res,500,{success:false,error:e.message}); }
});
await new Promise((resolve,reject)=>cloudServer.listen(cloudPort,'127.0.0.1',e=>e?reject(e):resolve()));

const fp=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
await fs.writeFile(path.join(dataDir,'identity-cache.json'),JSON.stringify({version:1,siteId:'E2E-SITE',edgeId:'E2E-EDGE',entries:{[fp]:{userId:'e2e-user',email:'e2e@example.test',role:'Admin',active:true,permissions:{p_settings:true,p_dossier:true,p_notes:true},isTeacher:false,assignedSubjects:{},isMaster:true,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));

const env={...process.env,EDU_EDGE_PORT:String(edgePort),EDU_EDGE_HOST:'127.0.0.1',EDU_EDGE_SITE_ID:'E2E-SITE',EDU_EDGE_ID:'E2E-EDGE',EDU_EDGE_DATA_DIR:dataDir,EDU_EDGE_CLOUD_URL:`http://127.0.0.1:${cloudPort}`,EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'true',EDU_EDGE_RETRY_MS:'5000'};
let edge;
function startEdge(){ edge=spawn(process.execPath,[edgeScript],{cwd:root,env,stdio:['ignore','pipe','pipe']}); }
function stopEdge(){return new Promise(resolve=>{if(!edge||edge.exitCode!==null)return resolve(); const t=setTimeout(()=>edge.kill('SIGKILL'),3000); edge.once('exit',()=>{clearTimeout(t);resolve()}); edge.kill('SIGTERM');});}
async function waitHealth(){for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${edgePort}/edge/health`);if(r.ok)return r.json()}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Edge startup timeout');}
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Eduhaiti-Device-Id':deviceId};

try {
  startEdge(); await waitHealth();
  const reg=await fetch(`http://127.0.0.1:${edgePort}/edge/devices/register`,{method:'POST',headers,body:JSON.stringify({deviceId,userId:'e2e-user'})});
  assert.equal(reg.status,200);

  // 1) Terminal -> Edge -> Cloud in one connected path.
  const key='e2e-op-001';
  const entry={id:'E2E-ST-001',table:'students',op:'upsert',baseVersion:0,idempotencyKey:key,fields:{student_code:'E2E-ST-001',first_name:'Cloud',last_name:'Recovery'}};
  const push=await fetch(`http://127.0.0.1:${edgePort}/api?action=syncPush`,{method:'POST',headers,body:JSON.stringify({action:'syncPush',data:{deviceId,entries:[entry]}})});
  const pushBody=await push.json();
  assert.equal(push.status,200); assert.equal(pushBody.success,true); assert.equal(pushBody.outcomes?.[0]?.status,'applied');
  assert.equal(cloud.has('students:E2E-ST-001'),true);

  // 2) Replay same operation: Cloud must not create a second row.
  const replay=await fetch(`http://127.0.0.1:${edgePort}/api?action=syncPush`,{method:'POST',headers,body:JSON.stringify({action:'syncPush',data:{deviceId,entries:[entry]}})});
  const replayBody=await replay.json();
  assert.equal(replayBody.success,true);
  assert.equal(cloud.size,1);
  assert.equal(cloudOps.size,1);

  // 3) Cloud -> Edge pull: add a Cloud-only change, then pull it through Edge.
  const cloudTs=new Date(Date.now()+1000).toISOString();
  cloud.set('students:E2E-ST-002',{id:'E2E-ST-002',table:'students',fields:{student_code:'E2E-ST-002',first_name:'Arrivé',last_name:'Cloud'},version:1,updatedAt:cloudTs,deletedAt:null});
  const pull=await fetch(`http://127.0.0.1:${edgePort}/api?action=syncPull&table=students&cursor=1970-01-01T00:00:00.000Z`,{headers});
  const pullBody=await pull.json();
  assert.equal(pull.status,200); assert.equal(pullBody.success,true);
  assert.equal(pullBody.rows.some(r=>r.id==='E2E-ST-002'),true);

  // 4) Edge local fallback still exposes the Cloud-reconciled state.
  const local=await fetch(`http://127.0.0.1:${edgePort}/edge/local-api?action=getStudents`,{headers});
  const localBody=await local.json();
  assert.equal(local.status,200); assert.equal(localBody.data.some(r=>r.StudentCode==='E2E-ST-001'),true); assert.equal(localBody.data.some(r=>r.StudentCode==='E2E-ST-002'),true);

  // 5) Restart Edge and verify the reconciled state survives process loss.
  await stopEdge(); startEdge(); await waitHealth();
  const after=await fetch(`http://127.0.0.1:${edgePort}/edge/local-api?action=getStudents`,{headers});
  const afterBody=await after.json();
  assert.equal(after.status,200); assert.equal(afterBody.data.some(r=>r.StudentCode==='E2E-ST-001'),true); assert.equal(afterBody.data.some(r=>r.StudentCode==='E2E-ST-002'),true);

  console.log('EDGE-0056 cloud reconnect end-to-end test: PASS');
  console.log(JSON.stringify({cloudRows:cloud.size,cloudOperations:cloudOps.size,reconciledStudents:2,siteId:'E2E-SITE',edgeId:'E2E-EDGE'},null,2));
} finally {
  await stopEdge();
  await new Promise(resolve=>cloudServer.close(resolve));
  await fs.rm(dataDir,{recursive:true,force:true});
}
