import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const source = process.env.CODEGS_PATH || '/mnt/data/source/Code.gs.txt';
const code = fs.readFileSync(source, 'utf8');
const actionsIndex = fs.readFileSync(path.join(root, 'src/actions/index.js'), 'utf8');
const apiHub = fs.readFileSync(path.join(root, 'src/lib/apiHub.js'), 'utf8');

// The Apps Script dispatcher is the authoritative action contract. Capture
// explicit action comparisons/cases, then remove obvious JS property/string
// false positives by requiring names to look like action identifiers.
const candidates = new Set();
const hubStart = code.indexOf('function apiHub(action, data, auth)');
const hubEnd = code.indexOf('\nfunction ensureInfraReadyThrottled_', hubStart);
const hubCode = hubStart >= 0 && hubEnd > hubStart ? code.slice(hubStart, hubEnd) : code;
for (const m of hubCode.matchAll(/action\s*===\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)) candidates.add(m[1]);
for (const m of hubCode.matchAll(/case\s+['"]([A-Za-z][A-Za-z0-9_]*)['"]\s*:/g)) candidates.add(m[1]);
// Remove non-action constants accidentally matching the dispatcher syntax.
for (const bad of ['DROP_STUDENT']) candidates.delete(bad);

// Cloudflare currently exposes these action keys from src/actions/index.js.
const workerActions = new Set();
const objectMatch = actionsIndex.match(/export const actions\s*=\s*\{([\s\S]*?)\n\};/);
if (objectMatch) {
  for (const line of objectMatch[1].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    for (const m of t.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\b\s*(?:,|:)/g)) {
      const n = m[1];
      if (!['const','actions','export'].includes(n)) workerActions.add(n);
    }
  }
}

// Worker-native actions are not necessarily in Code.gs and should not be
// counted as a legacy port.
const native = new Set(['registerAccount','fetchConfig','checkSubdomainAvailable','getPushConfig','registerPushSubscription','unregisterPushSubscription','listPushNotifications','syncPull','syncPush','syncGeneratedIds','seedBadgeStudents','backupDatabaseToR2','issueCertificate','listCertificates','getCertificate','revokeCertificate','verifyCertificate','getCertificatePrintHtml','getMonCashConfig','saveMonCashConfig','testMonCashConnection','createMonCashPayment','getMonCashPaymentStatus','getFullCurriculum','getStudentById']);

function domain(name) {
  const n = name.toLowerCase();
  if (/student|enroll|promotion|bulletin|rank|pin/.test(n)) return 'Élèves';
  if (/grade|exam|homework|quiz|curriculum|subject|score/.test(n)) return 'Notes / Examens';
  if (/attendance|clockin|late|transport/.test(n)) return 'Présences';
  if (/payment|moncash|finance|payroll/.test(n)) return 'Finance / Paiements';
  if (/timetable|assignment/.test(n)) return 'Emploi du temps / Affectations';
  if (/media|document|logo|screenshot/.test(n)) return 'Médias / Documents';
  if (/parent/.test(n)) return 'Portail parent';
  if (/notification|message|announcement|communication|sms|whatsapp/.test(n)) return 'Communication';
  if (/ai|translate|chat|appreciation/.test(n)) return 'IA';
  if (/staff|user|admin|role|godmode|access|password|profile/.test(n)) return 'Utilisateurs / Administration';
  if (/school|settings|configuration|academic|year|cache|init|backup/.test(n)) return 'École / Paramètres';
  if (/audit|security|diagnos|alert/.test(n)) return 'Audit / Sécurité';
  if (/report|analytics|dashboard|complex|universal|immersive/.test(n)) return 'Rapports / Analytics';
  if (/certificate/.test(n)) return 'Certificats';
  if (/kiosk/.test(n)) return 'Kiosque';
  if (/portal/.test(n)) return 'Portails';
  return 'Autres';
}

const actions = [...candidates].filter(a => !['ACTION','ACTOR','CEIL','CHANGE','CIBLE','DATE','DETAILS','DETAILSJSON','FLOOR','GRADELEVELID','HISTORYID','IDECOLE','ISERROR','JSON','METAJSON','PERM','PERMISSION','PERMUSED','POURQUOI','REFUND','SCHOOLYEAR','SECTION','STATUS','STATUT','STUDENTID','SubjectID','TARGET','TIMESTAMP','UPDATEDAT','USER','UTILISATEUR','UpdatedAt','RowKey','CheckID','ClassKey','GradeID','HistoryID','Mention','Period','PeriodID','Score','ScoresJSON','Section','Status','StudentID','SchoolYear','SubjectID','Timestamp'].includes(a)).sort();

const rows = actions.map(a => {
  const inWorker = workerActions.has(a);
  const isNative = native.has(a);
  let status = inWorker ? 'PORTÉ' : 'À PORTER';
  if (isNative && !candidates.has(a)) status = 'NATIF WORKER';
  return { action:a, domain:domain(a), status, workerExport:inWorker, codeGsContract:true };
});

const summary = {};
for (const r of rows) summary[r.status] = (summary[r.status]||0)+1;
const byDomain = {};
for (const r of rows) (byDomain[r.domain] ||= {total:0,ported:0,remaining:0,actions:[]});
for (const r of rows) { const d=byDomain[r.domain]; d.total++; if(r.status==='PORTÉ')d.ported++; if(r.status==='À PORTER')d.remaining++; d.actions.push(r.action); }

const outDir = path.join(root,'docs'); fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'CODEGS-0061-INVENTORY.json'), JSON.stringify({source,generatedAt:new Date().toISOString(),summary,byDomain,actions:rows},null,2));
let md = `# 0061 — Inventaire Code.gs → Cloudflare\n\nSource analysée : ${source}.\n\n## Résumé\n\n| Statut | Nombre |\n|---|---:|\n`;
for (const k of ['PORTÉ','À PORTER','NATIF WORKER']) if(summary[k]) md += `| ${k} | ${summary[k]} |\\n`;
md += `\n## Par domaine\n\n| Domaine | Total | Porté | À porter |\n|---|---:|---:|---:|\n`;
for (const [d,v] of Object.entries(byDomain).sort()) md += `| ${d} | ${v.total} | ${v.ported} | ${v.remaining} |\\n`;
md += `\n## Actions\n\n| Action | Domaine | Statut |\n|---|---|---|\n`;
for (const r of rows) md += `| ${r.action} | ${r.domain} | ${r.status} |\\n`;
fs.writeFileSync(path.join(outDir,'CODEGS-0061-INVENTORY.md'), md);

console.log(JSON.stringify({summary, domains:Object.fromEntries(Object.entries(byDomain).map(([k,v])=>[k,{total:v.total,ported:v.ported,remaining:v.remaining}]))},null,2));
