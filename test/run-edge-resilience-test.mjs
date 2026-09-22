import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const edge = await fs.readFile(path.join(root, 'edge/eduhaiti-edge.mjs'), 'utf8');
const offline = await fs.readFile(path.join(root, 'frontend-dist/offline-domain-integration.js'), 'utf8');

for (const needle of [
  'async function atomicWriteFile',
  'atomicWriteFile(QUEUE_FILE, snapshot)',
  'atomicWriteFile(STORE_FILE, snapshot)',
  'atomicWriteFile(MEDIA_QUEUE_FILE, q)',
]) if (!edge.includes(needle)) throw new Error(`Missing Edge resilience marker: ${needle}`);
for (const needle of [
  'let syncInFlight = null;',
  'async function syncNow()',
  'syncHeartbeat = setInterval',
  "window.addEventListener('pageshow'",
  "window.addEventListener('focus'",
]) if (!offline.includes(needle)) throw new Error(`Missing terminal resilience marker: ${needle}`);
console.log('EDGE-0054 resilience static test: PASS');
