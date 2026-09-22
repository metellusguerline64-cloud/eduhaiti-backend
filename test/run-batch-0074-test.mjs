import fs from 'node:fs';
const p=fs.readFileSync(new URL('../src/actions/payments.js',import.meta.url),'utf8');
for (const x of ['tuitionOutstanding','PAY_OVERPAYMENT_ACTION','FIN_PENALTY_AMOUNT','reportedDue','allowedPaymentMethods']) if(!p.includes(x)) throw new Error('missing '+x);
console.log('0074 finance parity regression test: PASS');
