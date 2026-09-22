import assert from 'node:assert/strict';
import { actions } from '../src/actions/index.js';
assert.equal(typeof actions.saveKioskWatchCodes, 'function');
assert.equal(typeof actions.getKioskWatchCodes, 'function');
assert.equal(typeof actions.recordAttendance, 'function');
assert.equal(typeof actions.recordStudentAttendance, 'function');
assert.equal(typeof actions.verifyStudentByLast4, 'function');
console.log('0066 kiosk + attendance registry test: PASS');
