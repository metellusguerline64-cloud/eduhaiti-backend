import fs from 'node:fs';
const p=fs.readFileSync(new URL('../src/actions/payments.js',import.meta.url),'utf8');
const required=[
  'isTuitionPaymentPayload(payload)',
  'resolveExpectedTuition',
  'tuitionOutstanding',
  'allowedPaymentMethods',
  'PAY_OVERPAYMENT_ACTION',
  'penaltyForPayment',
  'smartTuitionDescription',
  'cashier_name',
  'submitOnlinePayment',
  'approveOnlinePayment',
  'rejectOnlinePayment'
];
for(const x of required) if(!p.includes(x)) throw new Error('missing final finance behavior: '+x);
for(const stale of ['penaltyApplied is always 0','not enforced','whole "Groupe B" online-payment flow','schedule/penalty machinery exists on the Worker side yet'])
  if(p.includes(stale)) throw new Error('stale finance gap remains: '+stale);
console.log('0075 finance final parity static test: PASS');
