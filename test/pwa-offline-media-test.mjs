import fs from 'node:fs';
const root = new URL('../frontend-dist/', import.meta.url);
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
const media = fs.readFileSync(new URL('offline-media.js', root), 'utf8');
const domain = fs.readFileSync(new URL('offline-domain.js', root), 'utf8');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
for (const [name,text] of [['sw.js',sw],['offline-media.js',media],['offline-domain.js',domain]]) {
  if (!text.trim()) throw new Error(`${name} is empty`);
}
for (const token of ['mediaBlobs','mediaOutbox','runMediaBackgroundSync','uploadMediaFile','saveMedia']) {
  if (!sw.includes(token) && !media.includes(token) && !domain.includes(token)) throw new Error(`Missing media sync token: ${token}`);
}
if (!html.includes('/offline-media.js')) throw new Error('offline-media.js not loaded by frontend');
if (!domain.includes("listMedia: 'media'")) throw new Error('listMedia is not a promoted offline domain');
console.log('PWA offline media test: PASS');
