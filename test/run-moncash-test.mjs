import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { saveMonCashConfig, getMonCashConfig, testMonCashConnection, createMonCashPayment, getMonCashPaymentStatus, handleMonCashReturn } from "../src/actions/moncash.js";

const DB_PATH="/tmp/eduhaiti-moncash-test.sqlite"; try{fs.unlinkSync(DB_PATH)}catch{}
const db=makeD1(DB_PATH);
db._raw.exec(fs.readFileSync(new URL("../schema.sql",import.meta.url),"utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0018_moncash.sql",import.meta.url),"utf8"));
db._raw.prepare(`INSERT INTO settings(key,value) VALUES('ORG_ID','ORG-A'),('CURRENCY','HTG'),('TUITION_AMOUNT_GLOBAL','5000'),('currentAcademicYear','2026-2027')`).run();
const env={DB:db,ORG_ID:"ORG-A",MONCASH_CREDENTIALS_KEY:"test-encryption-key"};
const ids={student:crypto.randomUUID(),admin:crypto.randomUUID()};
db._raw.prepare(`INSERT INTO users(id,user_id,email,name,role,password_hash,permissions_json,is_master,is_god_mode,active) VALUES(?,?,?,?,?,?,?,?,?,1)`).run(ids.student,"STU-A","student@a.ht","Student A","STUDENT","x","{}",0,0);
db._raw.prepare(`INSERT INTO users(id,user_id,email,name,role,password_hash,permissions_json,is_master,is_god_mode,active) VALUES(?,?,?,?,?,?,?,?,?,1)`).run(ids.admin,"ADM-A","admin@a.ht","Admin A","ADMIN","x",JSON.stringify({p_settings:true,p_finance:true}),0,0);
db._raw.prepare(`INSERT INTO students(id,student_code,org_id,first_name,last_name,current_level,section,active) VALUES(?,?,?,?,?,?,?,1)`).run(crypto.randomUUID(),"STU-A","ORG-A","Jean","A","NS4","A");
db._raw.prepare(`INSERT INTO student_history(id,history_id,student_id,org_id,school_year,grade_level_id,section,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')`).run(crypto.randomUUID(),"H-A","STU-A","ORG-A","2026-2027","NS4","A");
for(const [token,id,email,role] of [["student-token",ids.student,"student@a.ht","STUDENT"],["admin-token",ids.admin,"admin@a.ht","ADMIN"]]) db._raw.prepare(`INSERT INTO sessions(token,user_id,email,payload,expires_at) VALUES(?,?,?,?,?)`).run(token,id,email,JSON.stringify({userId:id,email,role}),Date.now()+3600000);
const studentAuth={token:"student-token"},adminAuth={token:"admin-token"};

const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,init={})=>{
  if(String(url).includes("/oauth/token")) return new Response(JSON.stringify({access_token:"ACCESS",token_type:"bearer",expires_in:59}),{status:200});
  if(String(url).includes("/v1/CreatePayment")) return new Response(JSON.stringify({status:202,mode:"sandbox",payment_token:{token:"TOKEN-123"}}),{status:202});
  if(String(url).includes("/v1/RetrieveOrderPayment")) { const b=JSON.parse(init.body||"{}"); return new Response(JSON.stringify({status:200,payment:{reference:b.orderId,transaction_id:"TX-1",cost:1000,message:"successful",payer:"50900000000"}}),{status:200}); }
  if(String(url).includes("/v1/RetrieveTransactionPayment")) { const row=db._raw.prepare(`SELECT order_id,amount FROM moncash_payments WHERE id=?`).get(globalThis.__moncashPaymentId); return new Response(JSON.stringify({status:200,payment:{reference:row?.order_id||"",transaction_id:"A",cost:Number(row?.amount||1000),message:"successful",payer:"50900000000"}}),{status:200}); }
  throw new Error("Unexpected fetch: "+url);
};

console.log("=== credentials absent/configure securely ===");
let r=await getMonCashConfig({},adminAuth,env); console.assert(r.success===true&&r.config.configured===false,r);
r=await saveMonCashConfig({enabled:true,environment:"SANDBOX",businessKey:"BK-A",clientId:"CID-A",clientSecret:"SECRET-A",apiKey:"APIKEY-A"},adminAuth,env);
console.assert(r.success===true&&r.config.hasClientSecret===true&&r.config.businessKey==="********"&&r.config.clientId==="********",r);
const stored=db._raw.prepare(`SELECT value FROM settings WHERE key='MONCASH_CONFIG_ENC'`).get(); console.assert(stored.value&&!stored.value.includes("SECRET-A"),"Secret must not be stored plaintext",stored);
console.log("=== connection test ===");
r=await testMonCashConnection({},adminAuth,env); console.assert(r.success===true,r);

console.log("=== create payment derives tenant/student and creates PENDING ===");
r=await createMonCashPayment({studentId:"STU-A",paymentType:"TUITION",amount:1000,description:"Frais scolaires"},studentAuth,env);
console.assert(r.success===true&&r.status==="PENDING"&&r.redirectUrl.includes("Payment/Redirect?token=TOKEN-123"),r);
const local=db._raw.prepare(`SELECT * FROM moncash_payments WHERE id=?`).get(r.paymentId); globalThis.__moncashPaymentId=local.id;
console.assert(local.org_id==="ORG-A"&&local.student_id==="STU-A"&&local.order_id===r.orderId&&local.status==="PENDING",local);

console.log("=== amount above server-calculated due is rejected ===");
r=await createMonCashPayment({studentId:"STU-A",amount:6000},studentAuth,env); console.assert(r.success===false&&/solde dû/.test(r.error),r);

console.log("=== server status verification moves PENDING -> PAID and creates one Finance payment ===");
r=await getMonCashPaymentStatus({paymentId:local.id},studentAuth,env); console.assert(r.success===true&&r.status==="PAID"&&r.receiptId,r);
let finance=db._raw.prepare(`SELECT COUNT(*) c FROM payments WHERE org_id='ORG-A' AND client_request_id=?`).get(`MONCASH:${local.id}`);
console.assert(Number(finance.c)===1,finance);
const financeRow=db._raw.prepare(`SELECT status,amount FROM payments WHERE client_request_id=?`).get(`MONCASH:${local.id}`); console.assert(financeRow.status==='PARTIAL'&&Number(financeRow.amount)===1000,financeRow);
let notes=db._raw.prepare(`SELECT COUNT(*) c FROM notifications`).get(); console.assert(Number(notes.c)===1,notes);

console.log("=== repeated verification does not double-pay or re-notify ===");
db._raw.prepare(`UPDATE moncash_payments SET status='PENDING' WHERE id=?`).run(local.id);
r=await getMonCashPaymentStatus({paymentId:local.id},studentAuth,env); console.assert(r.success===true&&r.status==="PAID",r);
finance=db._raw.prepare(`SELECT COUNT(*) c FROM payments WHERE org_id='ORG-A' AND client_request_id=?`).get(`MONCASH:${local.id}`);
notes=db._raw.prepare(`SELECT COUNT(*) c FROM notifications`).get();
console.assert(Number(finance.c)===1&&Number(notes.c)===1,{finance,notes});

console.log("=== server-side return callback decrypts transaction id and is idempotent ===");
r=await saveMonCashConfig({apiKey:"MAgCAgyhAgER"},adminAuth,env); console.assert(r.success===true,r);
db._raw.prepare(`UPDATE moncash_payments SET status='PENDING',moncash_transaction_id=NULL WHERE id=?`).run(local.id);
const callbackRes=await handleMonCashReturn(new Request("https://mt1967.eduflow.win/api/moncash/return?transactionId=Akw="),env);
const callbackJson=await callbackRes.json(); console.assert(callbackJson.success===true&&callbackJson.status==="PAID",callbackJson);
const callbackAgain=await handleMonCashReturn(new Request("https://mt1967.eduflow.win/api/moncash/return?transactionId=Akw="),env);
const callbackAgainJson=await callbackAgain.json(); console.assert(callbackAgainJson.success===true&&callbackAgainJson.status==="PAID",callbackAgainJson);
finance=db._raw.prepare(`SELECT COUNT(*) c FROM payments WHERE org_id='ORG-A' AND client_request_id=?`).get(`MONCASH:${local.id}`);
notes=db._raw.prepare(`SELECT COUNT(*) c FROM notifications`).get();
console.assert(Number(finance.c)===1&&Number(notes.c)===1,{finance,notes});

console.log("=== tenant/order isolation ===");
r=await createMonCashPayment({studentId:"NOPE",amount:100},studentAuth,env); console.assert(r.success===false,r);
const other=db._raw.prepare(`SELECT COUNT(*) c FROM moncash_payments WHERE org_id='ORG-B'`).get(); console.assert(Number(other.c)===0,other);

console.log("\nAll MonCash assertions passed.");
globalThis.fetch=originalFetch;
