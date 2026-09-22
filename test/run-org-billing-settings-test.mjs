import fs from 'node:fs';
import { makeD1 } from './d1shim.mjs';
import { storeSessionToken } from '../src/lib/session.js';
import { getSaaSSettings, updateSaaSSettings } from '../src/actions/settings.js';
import { checkAiQuota, getAiTokenStatus, recordAiDirectTokenUsage } from '../src/actions/ai_tokens.js';

const tenant = makeD1(':memory:');
tenant._raw.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
tenant._raw.exec(fs.readFileSync(new URL('../migrations/0024_ai_token_usage.sql', import.meta.url), 'utf8'));
tenant._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','MT1967')`).run();
tenant._raw.prepare(`INSERT INTO users(id,user_id,email,name,role,active,password_hash,permissions_json,is_master,is_god_mode) VALUES('u1','u1','admin@test','Admin','ADMIN',1,'x',?,0,0)`)
  .run(JSON.stringify({ p_settings: true, pa_save_settings: true, p_use_ai: true }));
await storeSessionToken(tenant, 'org-billing-token', { userId: 'u1', email: 'admin@test' }, 3600);

const master = makeD1(':memory:');
master._raw.exec(fs.readFileSync(new URL('../master-schema.sql', import.meta.url), 'utf8'));
master._raw.prepare(
  `INSERT INTO orgs(id,business_id,pin_hash,org_type,business_name,email,phone,subdomain,reg_token,
     address,contact_name,plan,expiration_date,design_json,rules_json,
     ai_pro_access,ai_daily_token_limit_pro,ai_daily_token_limit_free,
     ai_session_token_limit_pro,ai_session_token_limit_free,
     ai_monthly_token_limit_pro,ai_monthly_token_limit_free)
   VALUES('o1','MT1967','x','SCHOOL','École Meigens','ecole@meigens.ht','50900000000','mt1967','regtok',
     'Port-au-Prince','Jean Baptiste','PRO','2027-12-31T00:00:00.000Z','{}','{}',
     1,5000,500,2000,200,100000,10000)`
).run();

const env = { DB: tenant, MASTER_DB: master, ORG_ID: 'MT1967' };

console.log('=== getSaaSSettings merges MASTER_DB.orgs as the default layer ===');
let r = await getSaaSSettings({}, { token: 'org-billing-token' }, env);
console.assert(r.success === true, 'getSaaSSettings should succeed', r);
console.assert(r.data.schoolName === 'École Meigens', 'schoolName should come from orgs.business_name', r.data.schoolName);
console.assert(r.data.subscriptionPlan === 'PRO', 'subscriptionPlan should come from orgs.plan', r.data.subscriptionPlan);
console.assert(r.data.SCHOOL_ADDR === 'Port-au-Prince', 'SCHOOL_ADDR should come from orgs.address', r.data.SCHOOL_ADDR);
console.assert(r.data.CONTACT_NAME === 'Jean Baptiste', 'CONTACT_NAME should come from orgs.contact_name', r.data.CONTACT_NAME);
// Code.gs's getSaaSSettings_ cascade: schoolDirector always mirrors
// CONTACT_NAME, adminProxyEmail falls back to SCHOOL_EMAIL, and ADDRESS
// forward-fills SCHOOL_ADDR (here already equal since orgBilling.js sets
// both from orgs.address, but the cascade must hold either way).
console.assert(r.data.schoolDirector === 'Jean Baptiste', 'schoolDirector should mirror CONTACT_NAME', r.data.schoolDirector);
console.assert(r.data.adminProxyEmail === 'ecole@meigens.ht', 'adminProxyEmail should fall back to SCHOOL_EMAIL', r.data.adminProxyEmail);
console.assert(r.data.ADDRESS === 'Port-au-Prince', 'ADDRESS should mirror SCHOOL_ADDR', r.data.ADDRESS);
console.assert(typeof r.data.NUM_PERIODS === 'number' && r.data.NUM_PERIODS === 4, 'NUM_PERIODS should be numeric-normalized (default 4) like Code.gs', r.data.NUM_PERIODS);

console.log('=== local Settings still override the master layer ===');
await updateSaaSSettings({ schoolName: 'École Locale' }, { token: 'org-billing-token' }, env);
r = await getSaaSSettings({}, { token: 'org-billing-token' }, env);
console.assert(r.data.schoolName === 'École Locale', 'Local schoolName override should win', r.data.schoolName);
console.assert(r.data.subscriptionPlan === 'PRO', 'Unoverridden fields should still come from orgs', r.data.subscriptionPlan);

console.log('=== AI quota picks the PRO tier from the org row ===');
const quota = await checkAiQuota({}, { token: 'org-billing-token' }, env);
console.assert(quota.success === true && quota.limits.daily === 5000, 'PRO daily limit should come from orgs.ai_daily_token_limit_pro', quota);

await recordAiDirectTokenUsage({ tokensIn: 3000, tokensOut: 2500 }, { token: 'org-billing-token' }, env);
const status = await getAiTokenStatus({}, { token: 'org-billing-token' }, env);
console.assert(status.success === true && status.allowed === false, 'Usage above the PRO tier limit should be blocked', status);

console.log('=== an explicit local override still wins over the org tier ===');
await updateSaaSSettings({ DAILY_TOKEN_LIMIT: 999999 }, { token: 'org-billing-token' }, env);
const overridden = await checkAiQuota({}, { token: 'org-billing-token' }, env);
console.assert(overridden.limits.daily === 999999, 'Explicit local DAILY_TOKEN_LIMIT should override the org tier default', overridden);

console.log('\nAll org-billing settings assertions passed.');
