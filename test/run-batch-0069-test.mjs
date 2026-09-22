import { actions } from '../src/actions/index.js';
const expected=['loginWithIdAndPin','setupStaffPin','sendEmailVerification','verifyEmailOTP','ensureAiConfigurationLibrarySheets','initAiConfigurationLibrary','initAiMasterSheets','forceInitAiMasterSheets'];
const missing=expected.filter(x=>typeof actions[x]!=='function');
if(missing.length) throw new Error('Missing actions: '+missing.join(', '));
console.log(`0069 batch registry test: PASS (${expected.length} actions)`);
