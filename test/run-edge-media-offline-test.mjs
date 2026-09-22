import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'eduhaiti-edge-media-'));
const port=Number(18000+Math.floor(Math.random()*1000));
const env={...process.env,EDU_EDGE_PORT:String(port),EDU_EDGE_HOST:'127.0.0.1',EDU_EDGE_SITE_ID:'SITE-MEDIA-TEST',EDU_EDGE_DATA_DIR:dir,EDU_EDGE_CLOUD_URL:'',EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'false'};
const p=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>resolve(),800); p.stderr.on('data',d=>{}); p.stdout.on('data',d=>{if(String(d).includes('EduHaïti Edge')) resolve();}); p.on('error',reject);});
 // Seed an identity cache matching token fingerprint via the same runtime crypto contract.
 const token='media-test-token';
 const cryptoNode=await import('node:crypto');
 const fp=cryptoNode.createHash('sha256').update(token).digest('hex');
 const identity={version:1,siteId:'SITE-MEDIA-TEST',edgeId:'EDGE-SITE-MEDIA-TEST',entries:{[fp]:{userId:'u1',email:'u1@example.test',role:'ADMIN',active:true,permissions:{p_media:true},isTeacher:false,isMaster:false,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+86400000}}};
 await import('node:fs/promises').then(fs=>fs.writeFile(path.join(dir,'identity-cache.json'),JSON.stringify(identity),'utf8'));
 p.kill(); await new Promise(r=>setTimeout(r,150));
 const p2=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{const t=setTimeout(resolve,800);p2.on('error',reject);p2.stdout.on('data',d=>{if(String(d).includes('EduHaïti Edge')){clearTimeout(t);resolve();}})});
  const base=`http://127.0.0.1:${port}`;
  const content=Buffer.from('hello media').toString('base64');
  let r=await fetch(base+'/edge/media/upload',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({data:{clientMediaId:'m1',name:'hello.txt',mimeType:'text/plain',contentBase64:content,media:{id:'m1',title:'Hello',type:'DOC'}}})});
  assert.equal(r.status,200); let b=await r.json(); assert.equal(b.success,true); assert.equal(b.status,'pending');
  r=await fetch(base+'/edge/media-status',{headers:{Authorization:'Bearer '+token}}); b=await r.json(); assert.equal(b.success,true); assert.equal(b.pending,1);
  r=await fetch(base+'/edge/media',{headers:{Authorization:'Bearer '+token}}); b=await r.json(); assert.equal(b.rows.length,1); assert.equal(b.rows[0].name,'hello.txt');
  r=await fetch(base+'/edge/media/file?key='+encodeURIComponent(b.rows[0].fileKey),{headers:{Authorization:'Bearer '+token}}); assert.equal(r.status,200); assert.equal(await r.text(),'hello media');
  console.log('edge media offline staging + local serving: PASS');
 } finally {p2.kill();}
} finally {try{p.kill()}catch{}; await rm(dir,{recursive:true,force:true});}
