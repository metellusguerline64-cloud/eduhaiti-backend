import fs from 'node:fs';
const p='frontend-dist/edge-first.js';
const s=fs.readFileSync(p,'utf8');
const required=[
  "id=\"edu-edge-devices\"",
  "Réactiver",
  "changeDeviceState",
  "devices/",
  "window.confirm",
  "Dernière activité",
  ".edu-edge-status.revoked"
];
for(const x of required){ if(!s.includes(x)) throw new Error('missing dashboard feature: '+x); }
console.log('edge device dashboard + reactivation confirmation/status: PASS');
