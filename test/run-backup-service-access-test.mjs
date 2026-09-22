import { actions } from '../src/actions/index.js';
if (typeof actions.grantBackupServiceAccess !== 'function') throw new Error('grantBackupServiceAccess missing');
console.log('0065 backup service access compatibility test: PASS');
