import assert from 'node:assert/strict';
import { actions } from '../src/actions/index.js';
const names=['parentPortalLogin','parentPortalLoginV2','setupParentPin','checkParentPhoneStatus','submitParentRegistrationRequest','getParentPendingRequests','resolveParentRequest','activateParentAccount','getParentChildren','getParentChildAttendance','getParentChildIncidents','getParentAnnouncements'];
for(const n of names) assert.equal(typeof actions[n],'function',`${n} missing`);
console.log('0062 parent portal registry test: PASS');
