import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const edgeScript = path.join(root, 'edge/eduhaiti-edge.mjs');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eduhaiti-edge-chaos-'));
const port = 19000 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env,
  EDU_EDGE_PORT: String(port),
  EDU_EDGE_HOST: '127.0.0.1',
  EDU_EDGE_SITE_ID: 'CHAOS-SITE',
  EDU_EDGE_ID: 'CHAOS-EDGE',
  EDU_EDGE_DATA_DIR: dataDir,
  EDU_EDGE_CLOUD_URL: '',
  EDU_EDGE_REQUIRE_REGISTERED_DEVICE: 'false',
  EDU_EDGE_REQUIRE_OFFLINE_AUTH: 'false',
  EDU_EDGE_RETRY_MS: '5000',
  EDU_EDGE_HEALTH_WATCHDOG_MS: '10000'
};

let child;
function start() {
  child = spawn(process.execPath, [edgeScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => process.stdout.write(`[edge] ${b}`));
  child.stderr.on('data', b => process.stderr.write(`[edge:err] ${b}`));
  return child;
}
function stop(signal='SIGTERM') {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill(signal);
  });
}
async function waitForHealth(timeout=5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/edge/health`);
      if (r.ok) return r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Edge n’est pas devenu disponible.');
}
async function postSync(key, value) {
  const body = { action:'syncPush', data:{deviceId:'CHAOS-DEVICE', entries:[
    {idempotencyKey:key, table:'students', op:'upsert', id:key, baseVersion:0, fields:{first_name:value}}
  ]}};
  const r = await fetch(`http://127.0.0.1:${port}/api?action=syncPush`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if (!r.ok) throw new Error(`syncPush HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}
async function readQueue() {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'sync-queue.json'), 'utf8'));
}
async function readStore() {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'site-store.json'), 'utf8'));
}

try {
  start();
  await waitForHealth();

  const key1 = 'chaos-op-001';
  const first = await postSync(key1, 'Après-coupure');
  if (!first.edgeQueued) throw new Error('La première opération ne reste pas en queue hors Cloud.');

  const queue1 = await readQueue();
  if (queue1.length !== 1 || queue1[0].status !== 'pending') throw new Error('Queue initiale invalide.');
  const store1 = await readStore();
  if (store1.tables?.students?.[key1]?.first_name !== 'Après-coupure') throw new Error('Store local non appliqué.');

  // Simule une panne brutale : le processus est tué sans procédure d’arrêt applicative.
  await stop('SIGKILL');

  // Redémarrage complet : la queue et le store doivent être reconstruits depuis le disque.
  start();
  await waitForHealth();
  const queue2 = await readQueue();
  const store2 = await readStore();
  if (queue2.length !== 1 || queue2[0].status !== 'pending' || queue2[0].key !== key1) throw new Error('Queue non récupérée après redémarrage brutal.');
  if (store2.tables?.students?.[key1]?.first_name !== 'Après-coupure') throw new Error('Store non récupéré après redémarrage brutal.');

  // Rejoue exactement la même clé : aucune deuxième entrée ne doit être créée.
  const replay = await postSync(key1, 'Après-coupure');
  if (!replay.edgeQueued) throw new Error('Replay idempotent inattendu.');
  const queue3 = await readQueue();
  if (queue3.length !== 1) throw new Error('Le replay a créé un doublon dans la queue.');

  // Deuxième opération : elle doit coexister avec la première et survivre à un nouveau crash.
  const key2 = 'chaos-op-002';
  await postSync(key2, 'Deuxième-opération');
  await stop('SIGKILL');
  start();
  await waitForHealth();
  const queue4 = await readQueue();
  if (queue4.length !== 2 || !queue4.every(x => x.status === 'pending')) throw new Error('Toutes les opérations ne survivent pas au second redémarrage.');

  const health = await (await fetch(`http://127.0.0.1:${port}/edge/health`)).json();
  if (health.diagnostics?.queues?.pending !== 2) throw new Error('Le diagnostic de queue ne reflète pas les 2 opérations en attente.');

  console.log('EDGE-0055 chaos/recovery test: PASS');
  console.log(JSON.stringify({dataDir, pending:queue4.length, siteId:health.siteId, edgeId:health.edgeId}, null, 2));
} finally {
  await stop('SIGTERM');
  await fs.rm(dataDir, {recursive:true, force:true});
}
