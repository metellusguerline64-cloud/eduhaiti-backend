import { actions } from '../src/actions/index.js';
import fs from 'node:fs';
const inv = JSON.parse(fs.readFileSync(new URL('../docs/CODEGS-0070-INVENTORY.json', import.meta.url)));
const expected = new Set(Object.values(inv.byDomain).flatMap(d => d.actions));
const actual = new Set(Object.keys(actions));
const missing = [...expected].filter(x => !actual.has(x));
if (missing.length) throw new Error(`Missing actions: ${missing.join(', ')}`);
console.log(`Code.gs parity registry test: PASS (${expected.size}/${expected.size} inventory actions registered; ${actual.size} total runtime actions)`);
