import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-039-'));
const port = 18839;
const env = { ...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_HOST:'127.0.0.1', EDU_EDGE_SITE_ID:'TEST39', EDU_EDGE_ID:'EDGE-TEST39', EDU_EDGE_DATA_DIR:dir, EDU_EDGE_CLOUD_URL:'' };
const child = spawn(process.execPath, ['edge/eduhaiti-edge.mjs'], { env, stdio:'ignore' });
try {
  for (let i=0;i<40;i++) { try { const r=await fetch(`http://127.0.0.1:${port}/edge/health`); if(r.ok) break; } catch {} await new Promise(r=>setTimeout(r,50)); }
  const store={version:1,siteId:'TEST39',edgeId:'EDGE-TEST39',tables:{students:{S1:{id:'S1',fields:{student_code:'S1',first_name:'A',last_name:'Test'},version:1,updatedAt:new Date().toISOString(),deleted:false}}},cursors:{},updatedAt:new Date().toISOString()};
  await fs.writeFile(path.join(dir,'site-store.json'), JSON.stringify(store));
  const token='test-business-039';
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  await fs.writeFile(path.join(dir,'identity-cache.json'), JSON.stringify({version:1,siteId:'TEST39',edgeId:'EDGE-TEST39',entries:{[digest]:{userId:'u1',email:'u1@test',role:'Admin',active:true,permissions:{p_dossier:true},isTeacher:false,assignedSubjects:{},isMaster:false,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));
  // restart so the Edge loads the seeded store and identity
  child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,100));
  const c2=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{env,stdio:'ignore'});
  try {
    for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${port}/edge/health`);if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
    const reg=await fetch(`http://127.0.0.1:${port}/edge/devices/register`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Eduhaiti-Device-Id':'device-039'},body:JSON.stringify({deviceId:'device-039'})});
    assert.equal(reg.status,200);
    let r=await fetch(`http://127.0.0.1:${port}/edge/local-api?action=getStudents`,{headers:{Authorization:'Bearer '+token,'X-Eduhaiti-Device-Id':'device-039'}});
    assert.equal(r.status,200); const b=await r.json(); assert.equal(b.success,true); assert.equal(b.edgeServed,true); assert.equal(b.data[0].StudentCode,'S1');
    r=await fetch(`http://127.0.0.1:${port}/edge/local-api?action=getStudents`); assert.equal(r.status,401);
    console.log('PASS edge local business API: cached student read + identity/permission gate');
  } finally { c2.kill('SIGTERM'); }
} finally { try{child.kill('SIGTERM')}catch{} await fs.rm(dir,{recursive:true,force:true}); }
