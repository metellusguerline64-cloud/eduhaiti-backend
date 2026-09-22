import assert from 'node:assert/strict';
import { actions } from '../src/actions/index.js';
const names = ['checkAndInitSheets','checkCacheHealth','clearAllSchoolCaches','createSaaSBackup','ensureSchoolIdsSheet','initSchoolIdsSheet','initSheets','initializeSheetHeaders','runGlobalBackupTask','warmSchoolCaches'];
for (const n of names) assert.equal(typeof actions[n], 'function', `${n} missing from action registry`);
console.log('0064 school maintenance registry test: PASS');
