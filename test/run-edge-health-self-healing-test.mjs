import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eduhaiti-edge-health-'));
const port=9400+Math.floor(Math.random()*300);
const env={...process.env,EDU_EDGE_PORT:String(port),EDU_EDGE_DATA_DIR:dir,EDU_EDGE_CLOUD_URL:'',EDU_EDGE_PROVISIONING_ENABLED:'false',EDU_EDGE_HEALTH_WATCHDOG_MS:'10000'};
const child=spawn(process.execPath,['edge/eduhaiti-edge.mjs'],{env,stdio:['ignore','pipe','pipe']});
try {
 let ok=false;
 for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${port}/edge/health`);if(r.ok){const j=await r.json();assert.equal(j.success,true);assert.ok(j.diagnostics.disk);assert.ok(j.diagnostics.queues);assert.ok(j.diagnostics.media);assert.ok(['ok','warning','critical','unknown'].includes(j.status));ok=true;break;}}catch{} await new Promise(r=>setTimeout(r,100));}
 assert.equal(ok,true,'Edge health endpoint did not become ready');
 const r=await fetch(`http://127.0.0.1:${port}/edge/health`); const j=await r.json();
 assert.equal(j.diagnostics.cloud.configured,false);
 assert.equal(j.diagnostics.disk.available,true);
 console.log('edge health diagnostics + watchdog: PASS');
} finally {child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,150)); await fs.rm(dir,{recursive:true,force:true});}
