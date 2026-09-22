import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eduhaiti-edge-prov-'));
const port=19500+Math.floor(Math.random()*300);
const edge=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{cwd:process.cwd(),env:{...process.env,EDU_EDGE_PORT:String(port),EDU_EDGE_CLOUD_URL:'',EDU_EDGE_DATA_DIR:dir,EDU_EDGE_SITE_ID:'SITE-PROV',EDU_EDGE_ID:'EDGE-PROV-01',EDU_EDGE_PROVISION_CODE:'TEST-PROV-CODE'},stdio:['ignore','pipe','pipe']});
const base=`http://127.0.0.1:${port}`; let ready=false;
for(let i=0;i<50;i++){try{const r=await fetch(base+'/edge/health');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
assert.equal(ready,true);
const d=await (await fetch(base+'/.well-known/eduhaiti-edge')).json(); assert.equal(d.siteId,'SITE-PROV'); assert.equal(d.edgeId,'EDGE-PROV-01'); assert.equal(d.protocol,'eduhaiti-edge-discovery-v1');
const denied=await fetch(base+'/edge/provision',{method:'POST',headers:{'X-Eduhaiti-Provision-Code':'bad'}}); assert.equal(denied.status,401);
const ok=await fetch(base+'/edge/provision',{method:'POST',headers:{'Content-Type':'application/json','X-Eduhaiti-Provision-Code':'TEST-PROV-CODE'},body:JSON.stringify({origin:'https://school.example'})}); assert.equal(ok.status,200); const j=await ok.json(); assert.equal(j.provisioned,true); assert.equal(j.allowedOrigin,'https://school.example');
edge.kill('SIGTERM'); console.log('edge discovery + provisioning: PASS');
