import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..', import.meta.url));
const dir=path.join(root,'.tmp-edge-media-backup'); await fs.rm(dir,{recursive:true,force:true}); await fs.mkdir(path.join(dir,'media'),{recursive:true});
const token='test-token-0049'; const fp=crypto.createHash('sha256').update(token).digest('hex');
await fs.writeFile(path.join(dir,'identity-cache.json'),JSON.stringify({version:1,siteId:'TEST-SITE',edgeId:'EDGE-TEST',entries:{[fp]:{userId:'admin-1',email:'admin@test',role:'admin',active:true,permissions:{p_settings:true,p_media:true},isMaster:true,isGodMode:false,cachedAt:Date.now(),expiresAt:Date.now()+3600000}}}));
await fs.writeFile(path.join(dir,'media-index.json'),JSON.stringify({version:1,siteId:'TEST-SITE',edgeId:'EDGE-TEST',items:{'photo-1':{fileKey:'photo-1',name:'photo.jpg',mimeType:'image/jpeg',size:11,status:'pending',updatedAt:new Date().toISOString()}}}));
await fs.writeFile(path.join(dir,'media-queue.json'),JSON.stringify({version:1,siteId:'TEST-SITE',edgeId:'EDGE-TEST',items:[]})); await fs.writeFile(path.join(dir,'media','photo-1.bin'),Buffer.from('hello-media'));
const server=spawn(process.execPath,[path.join(root,'edge','eduhaiti-edge.mjs')],{cwd:root,env:{...process.env,EDU_EDGE_PORT:'8899',EDU_EDGE_SITE_ID:'TEST-SITE',EDU_EDGE_ID:'EDGE-TEST',EDU_EDGE_DATA_DIR:dir,EDU_EDGE_PROVISIONING_ENABLED:'false',EDU_EDGE_CLOUD_URL:'',EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'false'},stdio:'pipe'});
let out=''; server.stdout.on('data',d=>out+=d); server.stderr.on('data',d=>out+=d);
async function wait(){for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8899/edge/health');if(r.ok)return;}catch{} await new Promise(r=>setTimeout(r,100));}throw new Error('server not ready '+out);}
try{
 await wait(); const h={Authorization:'Bearer '+token};
 let r=await fetch('http://127.0.0.1:8899/edge/media-backup/export',{headers:h}); if(!r.ok)throw new Error('export '+r.status+' '+await r.text()); const archive=Buffer.from(await r.arrayBuffer()); if(archive.length<50)throw new Error('archive too small');
 r=await fetch('http://127.0.0.1:8899/edge/media-backup/inspect',{method:'POST',headers:{...h,'Content-Type':'application/gzip'},body:archive}); const ij=await r.json(); if(!r.ok||!ij.success||ij.files!==1)throw new Error('inspect '+JSON.stringify(ij));
 await fs.rm(path.join(dir,'media','photo-1.bin'));
 r=await fetch('http://127.0.0.1:8899/edge/media-backup/restore?confirm=true',{method:'POST',headers:{...h,'Content-Type':'application/gzip'},body:archive}); const rr=await r.json(); if(!r.ok||!rr.success||rr.restored!==1)throw new Error('restore '+JSON.stringify(rr));
 const restored=await fs.readFile(path.join(dir,'media','photo-1.bin'),'utf8'); if(restored!=='hello-media')throw new Error('restored content mismatch');
 console.log('edge media backup archive + restore: PASS');
} finally {server.kill('SIGTERM'); await fs.rm(dir,{recursive:true,force:true});}
