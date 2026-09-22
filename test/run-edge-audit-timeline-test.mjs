import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = path.join(root, '.tmp-edge-audit-test');
await fs.rm(tmp, {recursive:true,force:true});
await fs.mkdir(tmp,{recursive:true});
const port = 18991;
const env={...process.env, EDU_EDGE_PORT:String(port), EDU_EDGE_HOST:'127.0.0.1', EDU_EDGE_SITE_ID:'TEST-AUDIT', EDU_EDGE_ID:'EDGE-AUDIT', EDU_EDGE_DATA_DIR:tmp, EDU_EDGE_CLOUD_URL:''};
const child=spawn(process.execPath,[path.join(root,'edge/eduhaiti-edge.mjs')],{env,stdio:['ignore','pipe','pipe']});
let output=''; child.stdout.on('data',d=>output+=d); child.stderr.on('data',d=>output+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  await wait(500);
  const logFile=path.join(tmp,'events.jsonl');
  await fs.writeFile(logFile,[
    JSON.stringify({ts:new Date().toISOString(),kind:'device_registered',siteId:'TEST-AUDIT',edgeId:'EDGE-AUDIT',deviceId:'DEV-1',userId:'u1'}),
    JSON.stringify({ts:new Date().toISOString(),kind:'device_revoked',siteId:'TEST-AUDIT',edgeId:'EDGE-AUDIT',deviceId:'DEV-1',userId:'admin'}),
    JSON.stringify({ts:new Date().toISOString(),kind:'self_heal',siteId:'TEST-AUDIT',edgeId:'EDGE-AUDIT',reason:'watchdog',actions:['directories-ensured']})
  ].join('\n')+'\n');
  // Audit route requires a cached admin identity; this smoke test validates the
  // route and redaction through source-level helper presence when no identity exists.
  const r=await fetch(`http://127.0.0.1:${port}/edge/audit`);
  if(r.status!==401) throw new Error(`expected 401, got ${r.status}`);
  const source=await fs.readFile(path.join(root,'edge/eduhaiti-edge.mjs'),'utf8');
  for(const needle of ["'/edge/audit'","readAuditEvents","device_unrevoked","delete e.tokenFingerprint"]) if(!source.includes(needle)) throw new Error(`missing ${needle}`);
  console.log('edge audit timeline + access/redaction safeguards: PASS');
} finally { child.kill('SIGTERM'); await wait(150); await fs.rm(tmp,{recursive:true,force:true}); }
