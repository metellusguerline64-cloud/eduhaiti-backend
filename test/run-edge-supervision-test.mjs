import fs from 'node:fs';
import vm from 'node:vm';
const edge=fs.readFileSync(new URL('../edge/eduhaiti-edge.mjs',import.meta.url),'utf8');
const front=fs.readFileSync(new URL('../frontend-dist/edge-first.js',import.meta.url),'utf8');
if(!edge.includes("'/edge/overview'")) throw new Error('overview endpoint missing');
if(!edge.includes("'/edge/sync/flush'")) throw new Error('sync flush endpoint missing');
if(!front.includes('edu-edge-overview')) throw new Error('overview dashboard missing');
if(!front.includes('edu-edge-sync')) throw new Error('sync button missing');
console.log('edge supervision dashboard + sync controls: PASS');
