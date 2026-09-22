import fs from 'node:fs';
import assert from 'node:assert/strict';

const p = new URL('../docs/CODEGS-0061-INVENTORY.json', import.meta.url);
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
assert.equal(d.summary['PORTÉ'], 190);
assert.equal(d.summary['À PORTER'], 52);
assert.equal(d.actions.length, 242);
for (const name of ['getAllStudents','updateStudent','getGrades','getAttendance','getPayments','getStaffAssignments','getTimetableData','saveMedia']) {
  const row = d.actions.find(x => x.action === name);
  assert.ok(row, `missing ${name}`);
  assert.equal(row.status, 'PORTÉ', `${name} should be ported`);
}
for (const name of ['parentPortalLogin','getParentChildren','loginWithIdAndPin','getKioskWatchCodes']) {
  const row = d.actions.find(x => x.action === name);
  assert.ok(row, `missing ${name}`);
  assert.equal(row.status, 'À PORTER', `${name} should remain to port`);
}
console.log('0061 Code.gs inventory test: PASS');
