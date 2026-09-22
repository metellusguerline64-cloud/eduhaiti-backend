import fs from 'node:fs';
const idx=fs.readFileSync(new URL('../src/actions/index.js',import.meta.url),'utf8');
const mod=fs.readFileSync(new URL('../src/actions/template_upload.js',import.meta.url),'utf8');
if(!idx.includes('handleTemplateUpload')) throw new Error('registry missing');
if(!mod.includes('MEDIA_BUCKET')||!mod.includes('media_library')) throw new Error('R2 template port incomplete');
console.log('0070 template upload test: PASS (1 action)');
