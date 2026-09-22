import fs from 'node:fs';
const idx=fs.readFileSync(new URL('../src/actions/index.js',import.meta.url),'utf8');
const names=['checkAndUpdateAccountStatus','diagnoseSyncIssue','runAuditMigration','logAudit','writeAuditLog','writeAuditLog_','purgeExpiredTokens','getUnifiedDirectory','getDownloadPageData'];
for(const n of names) if(!new RegExp('\\b'+n+'\\b').test(idx)) throw new Error('Missing '+n);
console.log('0068 batch registry test: PASS (9 actions)');
