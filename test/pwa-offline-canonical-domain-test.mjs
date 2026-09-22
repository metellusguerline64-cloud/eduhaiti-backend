import fs from 'node:fs';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../frontend-dist/index.html', import.meta.url), 'utf8');
const domain = fs.readFileSync(new URL('../frontend-dist/offline-domain.js', import.meta.url), 'utf8');
const integration = fs.readFileSync(new URL('../frontend-dist/offline-domain-integration.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend-dist/sw.js', import.meta.url), 'utf8');

assert.match(html, /offline-domain\.js/);
assert.match(html, /offline-domain-integration\.js/);
assert.match(domain, /eduhaiti_offline_domain_v1/);
assert.match(domain, /enqueueTyped/);
assert.match(domain, /readDomainResponse/);
assert.match(domain, /RECORD_PAYMENT/);
assert.match(domain, /RECORD_GRADE/);
assert.match(domain, /MARK_ATTENDANCE/);
assert.match(integration, /IndexedDB is canonical/);
assert.match(integration, /syncPush/);
assert.match(integration, /syncPull/);
assert.match(sw, /runTypedDomainBackgroundSync/);
assert.match(sw, /domainAll\(db, 'outbox'\)/);
assert.match(sw, /action:'syncPush'/);
assert.match(sw, /action:'syncPull'/);
console.log('PWA canonical domain sync test: PASS');
