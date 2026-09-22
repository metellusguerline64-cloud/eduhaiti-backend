import fs from 'node:fs';
const edge=fs.readFileSync(new URL('../edge/eduhaiti-edge.mjs',import.meta.url),'utf8');
const front=fs.readFileSync(new URL('../frontend-dist/edge-first.js',import.meta.url),'utf8');
for (const p of ["'/edge/backup/export'","'/edge/backup/restore'"]) if(!edge.includes(p)) throw new Error('missing '+p);
for (const p of ['exportEdgeBackup','importEdgeBackup','edu-edge-backup-export','edu-edge-backup-import']) if(!front.includes(p)) throw new Error('missing frontend '+p);
if(!edge.includes("kind: 'eduhaiti-edge-operational-backup'")) throw new Error('backup kind missing');
if(!edge.includes('delete safe.tokenFingerprint')) throw new Error('backup must strip token fingerprints');
console.log('edge backup/recovery safeguards: PASS');
