import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eduhaiti-edge-0044-'));
const token='test-token-0044';
const fp=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
await fs.writeFile(path.join(dir,'identity-cache.json'),JSON.stringify({version:1,siteId:'SITE-T',edgeId:'EDGE-SITE-T',entries:{[fp]:{userId:'u1',email:'admin@test',role:'admin',active:true,permissions:{p_settings:true,pa_manage_users:true},isMaster:true,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));
const port=18944;
const child=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{env:{...process.env,EDU_EDGE_PORT:String(port),EDU_EDGE_CLOUD_URL:'',EDU_EDGE_DATA_DIR:dir,EDU_EDGE_SITE_ID:'SITE-T',EDU_EDGE_ID:'EDGE-SITE-T'},stdio:'ignore'});
try {
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>resolve(),1200); child.on('exit',c=>{clearTimeout(t);reject(new Error('edge exited '+c));});});
  const h={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  let r=await fetch(`http://127.0.0.1:${port}/edge/devices/register`,{method:'POST',headers:h,body:JSON.stringify({deviceId:'DEV-1'})}); assert.equal(r.status,200); let j=await r.json(); assert.equal(j.success,true); assert.equal(j.device.deviceId,'DEV-1');
  r=await fetch(`http://127.0.0.1:${port}/edge/devices`,{headers:h}); j=await r.json(); assert.equal(j.count,1); assert.equal(j.devices[0].status,'online');
  r=await fetch(`http://127.0.0.1:${port}/edge/devices/revoke`,{method:'POST',headers:h,body:JSON.stringify({deviceId:'DEV-1'})}); assert.equal(r.status,200);
  r=await fetch(`http://127.0.0.1:${port}/edge/devices/register`,{method:'POST',headers:h,body:JSON.stringify({deviceId:'DEV-1'})}); assert.equal(r.status,403); j=await r.json(); assert.match(j.error,/révoqué/i);
  console.log('edge device registry + revoke: PASS');
} finally {child.kill('SIGTERM'); await fs.rm(dir,{recursive:true,force:true});}
