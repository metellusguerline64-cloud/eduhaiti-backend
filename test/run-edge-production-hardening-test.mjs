import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const src=await fs.readFile(new URL('../edge/eduhaiti-edge.mjs',import.meta.url),'utf8');
for (const x of ['EDU_EDGE_REQUIRE_HTTPS','EDU_EDGE_TLS_CERT_FILE','EDU_EDGE_TLS_KEY_FILE','EDU_EDGE_ALLOWED_ORIGINS','EDU_EDGE_REQUIRE_REGISTERED_DEVICE','https.createServer','Origine non autorisée par cet Edge.','Terminal non autorisé.']) assert.ok(src.includes(x), x);
const env=await fs.readFile(new URL('../edge/.env.example',import.meta.url),'utf8');
for (const x of ['EDU_EDGE_REQUIRE_HTTPS=true','EDU_EDGE_ALLOWED_ORIGINS=','EDU_EDGE_REQUIRE_REGISTERED_DEVICE=true']) assert.ok(env.includes(x), x);
console.log('edge production hardening configuration: PASS');
