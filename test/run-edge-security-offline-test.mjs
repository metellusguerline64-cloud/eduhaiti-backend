import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..', import.meta.url));
const edgeFile=path.join(root,'edge','eduhaiti-edge.mjs');
const cloudPort=19991, edgePort=19992;
const token='SECURITY-USER-TOKEN';
let cloud;
cloud=http.createServer((req,res)=>{
  if(new URL(req.url,'http://localhost').searchParams.get('action')==='getViewerInfo'){
    res.setHeader('content-type','application/json');
    return res.end(JSON.stringify({success:true,userId:'user-sec',email:'user@school.test',role:'teacher',active:true,permissions:{pt_enter_grades:true,pa_manage_users:true},isTeacher:true,isMaster:false,isGodMode:false}));
  }
  if(new URL(req.url,'http://localhost').searchParams.get('action')==='syncPush'){
    res.setHeader('content-type','application/json');
    return res.end(JSON.stringify({success:true,outcomes:[]}));
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>cloud.listen(cloudPort,'127.0.0.1',r));
const dataDir=await mkdtemp(path.join(tmpdir(),'eduhaiti-sec-'));
const env={...process.env,EDU_EDGE_PORT:String(edgePort),EDU_EDGE_HOST:'127.0.0.1',EDU_EDGE_SITE_ID:'SITE-SEC',EDU_EDGE_ID:'EDGE-SEC',EDU_EDGE_DATA_DIR:dataDir,EDU_EDGE_CLOUD_URL:`http://127.0.0.1:${cloudPort}`,EDU_EDGE_REQUIRE_REGISTERED_DEVICE:'true',EDU_EDGE_REQUIRE_OFFLINE_AUTH:'true',EDU_EDGE_RETRY_MS:'60000'};
const child=spawn(process.execPath,[edgeFile],{env,stdio:['ignore','pipe','pipe']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function j(url,opts={}){const r=await fetch(url,opts);let b={};try{b=await r.json()}catch{};return {status:r.status,body:b};}
try{
  await wait(600);
  const base=`http://127.0.0.1:${edgePort}`;
  let r=await j(base+'/api?action=syncPush',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'syncPush',data:{siteId:'SITE-SEC',deviceId:'SEC-DEVICE',entries:[{idempotencyKey:'sec-1',table:'grades',op:'upsert',id:'g1',fields:{score:10}}]}})});
  if(r.status<400) throw new Error('unauthenticated syncPush was accepted');
  const headers={Authorization:'Bearer '+token};
  r=await j(base+'/?action=getViewerInfo',{headers});
  if(!r.body.success) throw new Error('viewer bootstrap failed');
  r=await j(base+'/api?action=syncPush',{method:'POST',headers:{...headers,'content-type':'application/json','X-Eduhaiti-Device-Id':'SEC-DEVICE'},body:JSON.stringify({action:'syncPush',data:{siteId:'WRONG-SITE',deviceId:'SEC-DEVICE',entries:[{idempotencyKey:'sec-2',table:'grades',op:'upsert',id:'g2',fields:{score:9}}]}})});
  if(r.status<400) throw new Error('cross-site sync accepted');
  r=await j(base+'/api?action=syncPush',{method:'POST',headers:{...headers,'content-type':'application/json','X-Eduhaiti-Device-Id':'SEC-DEVICE'},body:JSON.stringify({action:'syncPush',data:{siteId:'SITE-SEC',deviceId:'SEC-DEVICE',entries:[{idempotencyKey:'sec-3',table:'payments',op:'upsert',id:'p1',fields:{amount:100}}]}})});
  if(r.status<400) throw new Error('unauthorized payment sync accepted');
  // Device must be registered: register through the device endpoint using cached identity.
  r=await j(base+'/edge/devices/register',{method:'POST',headers:{...headers,'content-type':'application/json','X-Eduhaiti-Device-Id':'SEC-DEVICE'},body:JSON.stringify({deviceId:'SEC-DEVICE'})});
  if(!r.body.success) throw new Error('device registration failed');
  r=await j(base+'/api?action=syncPush',{method:'POST',headers:{...headers,'content-type':'application/json','X-Eduhaiti-Device-Id':'SEC-DEVICE'},body:JSON.stringify({action:'syncPush',data:{siteId:'SITE-SEC',deviceId:'SEC-DEVICE',entries:[{idempotencyKey:'sec-4',table:'grades',op:'upsert',id:'g4',fields:{score:18}}]}})});
  if(!r.body.success) throw new Error('authorized grade sync rejected');
  r=await j(base+'/edge/devices/revoke',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({deviceId:'SEC-DEVICE'})});
  if(!r.body.success) throw new Error('device revoke failed');
  r=await j(base+'/api?action=syncPush',{method:'POST',headers:{...headers,'content-type':'application/json','X-Eduhaiti-Device-Id':'SEC-DEVICE'},body:JSON.stringify({action:'syncPush',data:{siteId:'SITE-SEC',deviceId:'SEC-DEVICE',entries:[{idempotencyKey:'sec-5',table:'grades',op:'upsert',id:'g5',fields:{score:17}}]}})});
  if(r.status<400) throw new Error('revoked device sync accepted');
  console.log('EDGE-0057 offline security test: PASS');
} finally {child.kill('SIGTERM');await wait(250);cloud.close();await rm(dataDir,{recursive:true,force:true});}
