// MonCash online payments — tenant-isolated Worker integration.
// Official MonCash REST API references used for this implementation:
//   POST /Api/oauth/token
//   POST /Api/v1/CreatePayment
//   POST /Api/v1/RetrieveTransactionPayment
//   POST /Api/v1/RetrieveOrderPayment
// Redirect gateway: <GATEWAY_BASE>/Payment/Redirect?token=<payment-token>
//
// Credentials are encrypted before they are stored in the tenant D1 settings
// table. MONCASH_CREDENTIALS_KEY must be a Cloudflare Worker secret shared by
// the deployment, never sent to the frontend. The tenant itself is selected
// from the request Host header before apiHub is reached.

import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { assertStudentAccess, loadViewer } from "../lib/accessScope.js";
import { loadSessionToken } from "../lib/session.js";
import { getSetting } from "../lib/settings.js";
import { recordNewPayment } from "./payments.js";

const STATUS = new Set(["PENDING", "PAID", "FAILED", "CANCELLED", "EXPIRED", "REJECTED"]);

function authError() { return { success: false, error: "Session invalide." }; }
function nowIso() { return new Date().toISOString(); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(s) { return Uint8Array.from(atob(String(s)), c => c.charCodeAt(0)); }

async function cryptoKey(env) {
  const secret = String(env.MONCASH_CREDENTIALS_KEY || "").trim();
  if (!secret) throw new Error("Secret Worker MONCASH_CREDENTIALS_KEY manquant.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptJson(env, value) {
  const key = await cryptoKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return `${b64(iv)}.${b64(cipher)}`;
}

async function decryptJson(env, encoded) {
  if (!encoded) return null;
  const [ivPart, cipherPart] = String(encoded).split(".");
  if (!ivPart || !cipherPart) throw new Error("Configuration MonCash chiffrée invalide.");
  const key = await cryptoKey(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivPart) }, key, unb64(cipherPart));
  return JSON.parse(new TextDecoder().decode(plain));
}

function envUrls(environment) {
  const live = String(environment || "SANDBOX").toUpperCase() === "PRODUCTION";
  return {
    environment: live ? "PRODUCTION" : "SANDBOX",
    apiBase: live ? "https://moncashbutton.digicelgroup.com/Api" : "https://sandbox.moncashbutton.digicelgroup.com/Api",
    gatewayBase: live ? "https://moncashbutton.digicelgroup.com/Moncash-middleware" : "https://sandbox.moncashbutton.digicelgroup.com/Moncash-middleware",
  };
}

async function getStoredConfig(env) {
  const raw = await getSetting(env.DB, "MONCASH_CONFIG_ENC");
  if (!raw) return null;
  return decryptJson(env, raw);
}

function publicConfig(cfg) {
  if (!cfg) return { configured: false, enabled: false, environment: "SANDBOX", businessKey: "", clientId: "" };
  return {
    configured: true,
    enabled: cfg.enabled === true,
    environment: String(cfg.environment || "SANDBOX").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
    businessKey: cfg.businessKey ? "********" : "",
    clientId: cfg.clientId ? "********" : "",
    hasClientSecret: !!cfg.clientSecret,
    hasApiKey: !!cfg.apiKey,
  };
}

async function currentViewer(env, auth) {
  if (!auth?.token) return null;
  return loadViewer(env, auth);
}

function canConfigure(viewer) {
  return !!viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_settings || viewer.permissions?.pa_save_settings);
}

async function adminRecipients(env) {
  const { results = [] } = await env.DB.prepare(`SELECT id,email,permissions_json,is_master,is_god_mode FROM users WHERE deleted_at IS NULL AND active=1`).all();
  return results.filter(u => {
    if (Number(u.is_master) === 1 || Number(u.is_god_mode) === 1) return true;
    let p = {};
    try { p = JSON.parse(u.permissions_json || "{}"); } catch {}
    return !!(p.p_finance || p.p_approve_payments || p.p_settings || p.pa_save_settings);
  });
}

async function createInternalNotification(env, { title, message, category = "FINANCE", actionTarget = "" }) {
  const ts = nowIso();
  const recipients = await adminRecipients(env);
  for (const recipient of recipients) {
    const id = `NTF-${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO notifications(id,fields,version,updated_at,deleted_at) VALUES(?,?,1,?,NULL)`)
      .bind(id, JSON.stringify({ title, message, category, severity: "HIGH", createdAt: ts, targetEmail: recipient.email || "", actionTarget }), ts).run();
  }
}

async function moncashFetch(url, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { res, body };
  } finally { clearTimeout(timer); }
}

async function accessToken(cfg) {
  const { apiBase } = envUrls(cfg.environment);
  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
  const { res, body } = await moncashFetch(`${apiBase}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "scope=read,write&grant_type=client_credentials",
  });
  if (!res.ok || !body?.access_token) throw new Error(`Authentification MonCash échouée (${res.status}).`);
  return body.access_token;
}

function normalizePaymentStatus(body) {
  const p = body?.payment || body?.payment_details || body || {};
  const explicit = String(p.payment_status ?? body?.payment_status ?? "").toLowerCase();
  if (explicit === "true" || explicit === "paid" || explicit === "successful" || explicit === "success") return "PAID";
  if (explicit === "false" || explicit === "failed" || explicit === "failure" || explicit === "rejected") return "FAILED";
  const msg = String(p.message ?? body?.message ?? "").toLowerCase();
  if (msg.includes("success") || msg.includes("successful")) return "PAID";
  const statusCode = Number(body?.status);
  if (statusCode >= 400) return "FAILED";
  return "PENDING";
}

function paymentDetails(body) {
  const p = body?.payment || body?.payment_details || body || {};
  return {
    reference: String(p.reference || body?.reference || "").trim(),
    transactionId: String(p.transaction_id || p.transNumber || body?.transaction_id || "").trim(),
    amount: Number(p.cost ?? p.amount ?? body?.cost ?? 0),
    payer: String(p.payer || body?.payer || "").trim(),
    message: String(p.message || body?.message || "").trim(),
  };
}

async function retrieveOrder(cfg, orderId) {
  const token = await accessToken(cfg);
  const { apiBase } = envUrls(cfg.environment);
  const { res, body } = await moncashFetch(`${apiBase}/v1/RetrieveOrderPayment`, {
    method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) throw new Error(`Vérification MonCash échouée (${res.status}).`);
  return body;
}

async function retrieveTransaction(cfg, transactionId) {
  const token = await accessToken(cfg);
  const { apiBase } = envUrls(cfg.environment);
  const { res, body } = await moncashFetch(`${apiBase}/v1/RetrieveTransactionPayment`, {
    method: "POST", headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId }),
  });
  if (!res.ok) throw new Error(`Vérification MonCash échouée (${res.status}).`);
  return body;
}

function orderIdFor(orgId, studentId) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const short = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `${orgId}-${studentId}-${date}-${short}`.slice(0, 60);
}

async function outstandingForStudent(env, orgId, studentId) {
  const configured = Number(await getSetting(env.DB, "TUITION_AMOUNT_GLOBAL") || await getSetting(env.DB, "TUITION_AMOUNT") || 0);
  if (!Number.isFinite(configured) || configured <= 0) return { known: false, outstanding: 0 };
  const year = String(await getSetting(env.DB, "currentAcademicYear") || await getSetting(env.DB, "ACADEMIC_YEAR") || "").trim();
  const activeHistory = await env.DB.prepare(`SELECT history_id FROM student_history WHERE org_id=? AND student_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1`).bind(orgId, studentId).first();
  let query = `SELECT COALESCE(SUM(amount),0) total FROM payments WHERE org_id=? AND student_id=? AND deleted_at IS NULL AND status IN ('PAID','PARTIAL')`;
  const params = [orgId, studentId];
  if (activeHistory?.history_id) { query += ` AND history_id=?`; params.push(activeHistory.history_id); }
  const paid = Number((await env.DB.prepare(query).bind(...params).first())?.total || 0);
  return { known: true, outstanding: Math.max(0, configured - paid), configured, paid, academicYear: year };
}

export async function getMonCashConfig(_data, auth, env) {
  const viewer = await currentViewer(env, auth); if (!viewer) return authError();
  if (!canConfigure(viewer)) return { success:false, error:"Accès refusé." };
  try { return { success:true, config:publicConfig(await getStoredConfig(env)) }; }
  catch (e) { return { success:false, error:e.message }; }
}

export async function saveMonCashConfig(data, auth, env) {
  const viewer = await currentViewer(env, auth); if (!viewer) return authError();
  if (!canConfigure(viewer)) return { success:false, error:"Accès refusé." };
  try {
    const current = (await getStoredConfig(env)) || {};
    const next = {
      enabled: data?.enabled === undefined ? !!current.enabled : !!data.enabled,
      environment: String(data?.environment || current.environment || "SANDBOX").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
      businessKey: String(data?.businessKey || current.businessKey || "").trim(),
      clientId: String(data?.clientId || current.clientId || "").trim(),
      clientSecret: String(data?.clientSecret || current.clientSecret || "").trim(),
      apiKey: String(data?.apiKey || current.apiKey || "").trim(),
    };
    if (next.enabled && (!next.businessKey || !next.clientId || !next.clientSecret || !next.apiKey)) {
      return { success:false, error:"Configuration MonCash incomplète : Business Key, Client ID, Secret et API Key sont requis." };
    }
    await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('MONCASH_CONFIG_ENC',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .bind(await encryptJson(env, next), nowIso()).run();
    await writeAudit(env.DB,{table:"settings",rowId:"MONCASH_CONFIG_ENC",userId:viewer.id,op:"MONCASH_CONFIG_UPDATE",diff:{enabled:next.enabled,environment:next.environment,clientIdConfigured:!!next.clientId,businessKeyConfigured:!!next.businessKey,secretChanged:!!data?.clientSecret,apiKeyChanged:!!data?.apiKey}});
    return { success:true, config:publicConfig(next) };
  } catch(e) { return { success:false,error:e.message }; }
}

export async function testMonCashConnection(_data, auth, env) {
  const viewer = await currentViewer(env, auth); if (!viewer) return authError();
  if (!canConfigure(viewer)) return { success:false,error:"Accès refusé." };
  try {
    const cfg = await getStoredConfig(env);
    if (!cfg?.clientId || !cfg?.clientSecret) return {success:false,error:"Credentials MonCash non configurés."};
    await accessToken(cfg);
    return {success:true,environment:envUrls(cfg.environment).environment,message:"Connexion MonCash réussie."};
  } catch(e) { return {success:false,error:e.message}; }
}

export async function createMonCashPayment(data, auth, env) {
  const viewer = await currentViewer(env, auth); if (!viewer) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const studentId = String(data?.studentId || (String(viewer.role).toUpperCase()==="STUDENT" ? viewer.userId : "")).trim();
    if (!studentId) return {success:false,error:"Identifiant élève manquant."};
    const access = await assertStudentAccess(env, auth, orgId, studentId);
    if (!access.allowed) return {success:false,error:access.error};

    const cfg = await getStoredConfig(env);
    if (!cfg?.enabled) return {success:false,error:"Le paiement MonCash n'est pas activé pour cette école."};
    const due = await outstandingForStudent(env, orgId, studentId);
    const amount = Number(data?.amount);
    if (!due.known) return {success:false,error:"Impossible de vérifier le montant dû : configurez le montant des frais de scolarité avant d'activer MonCash."};
    if (!Number.isFinite(amount) || amount <= 0) return {success:false,error:"Montant invalide."};
    if (amount > due.outstanding + 0.000001) return {success:false,error:`Montant supérieur au solde dû (${due.outstanding}).`};
    if (amount <= 0 || due.outstanding <= 0) return {success:false,error:"Aucun montant n'est actuellement dû pour cet élève."};

    const student = access.student;
    const paymentId = `MCP-${crypto.randomUUID()}`;
    const orderId = orderIdFor(orgId, studentId);
    const currency = String(await getSetting(env.DB,"CURRENCY") || "HTG");
    const description = String(data?.description || data?.paymentType || "Frais scolaires").trim();
    const ts = nowIso();

    await env.DB.prepare(`INSERT INTO moncash_payments(id,org_id,student_id,user_id,amount,amount_due,currency,payment_type,description,order_id,moncash_transaction_id,moncash_reference,status,created_at,updated_at,paid_at,raw_response,version,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,'PENDING',?,?,NULL,NULL,1,NULL)`)
      .bind(paymentId,orgId,studentId,viewer.id||viewer.userId||null,amount,due.outstanding,currency,String(data?.paymentType||"TUITION"),description,orderId,ts,ts).run();

    try {
      const token = await accessToken(cfg);
      const { apiBase, gatewayBase } = envUrls(cfg.environment);
      const { res, body } = await moncashFetch(`${apiBase}/v1/CreatePayment`, {
        method:"POST", headers:{Accept:"application/json",Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        body:JSON.stringify({amount,orderId}),
      });
      if (!res.ok || !body?.payment_token?.token) throw new Error(`Création MonCash échouée (${res.status}).`);
      const paymentToken = String(body.payment_token.token);
      const redirectUrl = `${gatewayBase}/Payment/Redirect?token=${encodeURIComponent(paymentToken)}`;
      await env.DB.prepare(`UPDATE moncash_payments SET raw_response=?,updated_at=?,version=version+1 WHERE org_id=? AND id=?`)
        .bind(JSON.stringify({status:body.status,mode:body.mode}),ts,orgId,paymentId).run();
      await writeAudit(env.DB,{table:"moncash_payments",rowId:paymentId,userId:viewer.id,op:"create",diff:{studentId,amount,orderId,environment:cfg.environment}});
      return {success:true,paymentId,orderId,status:"PENDING",redirectUrl};
    } catch(e) {
      await env.DB.prepare(`UPDATE moncash_payments SET status='FAILED',raw_response=?,updated_at=?,version=version+1 WHERE org_id=? AND id=?`).bind(JSON.stringify({error:e.message}),nowIso(),orgId,paymentId).run();
      await writeAudit(env.DB,{table:"moncash_payments",rowId:paymentId,userId:viewer.id,op:"create_failed",diff:{studentId,orderId,error:e.message}});
      return {success:false,error:e.message,paymentId,orderId,status:"FAILED"};
    }
  } catch(e) { return {success:false,error:e.message}; }
}

async function recordMonCashFinance(env, row, details) {
  const clientRequestId = `MONCASH:${row.id}`;
  const existing = await env.DB.prepare(`SELECT id,amount,status FROM payments WHERE org_id=? AND client_request_id=? AND deleted_at IS NULL LIMIT 1`).bind(row.org_id,clientRequestId).first();
  if (existing) return {success:true,receiptId:existing.id,duplicate:true};
  const receiptId = `REC-${crypto.randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}`;
  const history = await env.DB.prepare(`SELECT history_id FROM student_history WHERE org_id=? AND student_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1`).bind(row.org_id,row.student_id).first();
  const ts=nowIso();
  await env.DB.prepare(`INSERT INTO payments(id,org_id,history_id,student_id,student_name,description,amount,cashier_email,status,notes,payment_date,reference,client_request_id,created_at,version,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NULL)`)
    .bind(receiptId,row.org_id,history?.history_id||null,row.student_id,`${row.student_first_name||""} ${row.student_last_name||""}`.trim(),row.description,row.amount,"moncash@eduhaiti.internal",(Number(row.amount)>=Number(row.amount_due||row.amount)?"PAID":"PARTIAL"),`MonCash ${row.order_id}`,ts,details.reference||details.transactionId||"",clientRequestId,ts,ts).run();
  return {success:true,receiptId,duplicate:false};
}

async function applyVerifiedPayment(env, cfg, row, body, source) {
  const details = paymentDetails(body);
  const status = normalizePaymentStatus(body);
  const amount = Number(details.amount || 0);
  const expected = Number(row.amount || 0);
  const orderMatches = !details.reference || details.reference === row.order_id;
  if (amount > 0 && Math.abs(amount - expected) > 0.000001) {
    await writeAudit(env.DB,{table:"moncash_payments",rowId:row.id,userId:null,op:"amount_mismatch",diff:{expected,received:amount,source}});
    return {success:false,error:"Montant MonCash différent du montant attendu.",status:"REJECTED"};
  }
  if (!orderMatches) return {success:false,error:"OrderId MonCash différent de la commande locale.",status:"REJECTED"};
  if (!STATUS.has(status)) return {success:false,error:"Statut MonCash inconnu.",status:"REJECTED"};

  const raw = JSON.stringify({source,status,details});
  if (status === "PAID") {
    if (String(row.status).toUpperCase() === "PAID") return {success:true,status:"PAID",duplicate:true,paymentId:row.id,orderId:row.order_id};
    const finance = await recordMonCashFinance(env,row,details);
    if (!finance?.success) return {success:false,error:finance?.error||"Impossible d'enregistrer le paiement Finance.",status:"FAILED"};
    const ts = nowIso();
    await env.DB.prepare(`UPDATE moncash_payments SET status='PAID',moncash_transaction_id=?,moncash_reference=?,raw_response=?,updated_at=?,paid_at=?,version=version+1 WHERE org_id=? AND id=? AND status!='PAID'`)
      .bind(details.transactionId,details.reference,raw,ts,ts,row.org_id,row.id).run();
    if (!finance.duplicate) await createInternalNotification(env,{title:"Nouveau paiement MonCash",message:`Élève : ${row.student_first_name||""} ${row.student_last_name||""}\nMontant : ${row.amount} ${row.currency}\nType : ${row.payment_type}\nRéférence : ${details.reference || details.transactionId || "-"}\nCommande : ${row.order_id}\nStatut : Paiement confirmé`,category:"FINANCE",actionTarget:`payment:${finance.receiptId||""}`});
    await writeAudit(env.DB,{table:"moncash_payments",rowId:row.id,userId:null,op:"paid",diff:{orderId:row.order_id,transactionId:details.transactionId,reference:details.reference,receiptId:finance.receiptId||""}});
    return {success:true,status:"PAID",duplicate:!!finance.duplicate,paymentId:row.id,orderId:row.order_id,receiptId:finance.receiptId||""};
  }

  const ts = nowIso();
  await env.DB.prepare(`UPDATE moncash_payments SET status=?,moncash_transaction_id=COALESCE(?,moncash_transaction_id),moncash_reference=COALESCE(?,moncash_reference),raw_response=?,updated_at=?,version=version+1 WHERE org_id=? AND id=? AND status!='PAID'`)
    .bind(status,details.transactionId||null,details.reference||null,raw,ts,row.org_id,row.id).run();
  await writeAudit(env.DB,{table:"moncash_payments",rowId:row.id,userId:null,op:"status",diff:{status,source}});
  return {success:true,status,paymentId:row.id,orderId:row.order_id};
}

export async function getMonCashPaymentStatus(data, auth, env) {
  const viewer = await currentViewer(env, auth); if (!viewer) return authError();
  try {
    const orgId = await resolveOrgId(env);
    const paymentId = String(data?.paymentId || "").trim();
    const orderId = String(data?.orderId || "").trim();
    const row = await env.DB.prepare(`SELECT m.*,s.first_name student_first_name,s.last_name student_last_name FROM moncash_payments m LEFT JOIN students s ON s.org_id=m.org_id AND s.student_code=m.student_id WHERE m.org_id=? AND m.deleted_at IS NULL AND (m.id=? OR m.order_id=?) LIMIT 1`).bind(orgId,paymentId,orderId).first();
    if (!row) return {success:false,error:"Paiement MonCash introuvable."};
    const access = await assertStudentAccess(env,auth,orgId,row.student_id);
    if (!access.allowed) return {success:false,error:access.error};
    if (row.status !== "PAID" && row.status !== "FAILED" && row.status !== "REJECTED" && row.status !== "CANCELLED" && row.status !== "EXPIRED") {
      const cfg = await getStoredConfig(env);
      if (cfg?.enabled) {
        const body = await retrieveOrder(cfg,row.order_id);
        const result = await applyVerifiedPayment(env,cfg,{...row,_session_token:auth.token},body,"status");
        return {...result,paymentId:row.id,orderId:row.order_id};
      }
    }
    return {success:true,paymentId:row.id,orderId:row.order_id,status:row.status};
  } catch(e) { return {success:false,error:e.message}; }
}

// The Return URL is a route, not a configurable admin action. The tenant is
// resolved from the request host before this function is called.
export async function handleMonCashReturn(request, env) {
  const url = new URL(request.url);
  const encryptedTransactionId = String(url.searchParams.get("transactionId") || "").trim();
  if (!encryptedTransactionId) return new Response("transactionId manquant.", {status:400});
  try {
    const cfg = await getStoredConfig(env);
    if (!cfg?.enabled) return new Response("MonCash non configuré pour cette école.", {status:503});

    // The legacy MonCash middleware return contract encrypts transactionId
    // with the merchant API key. Decrypting that value is intentionally done
    // server-side. The REST verification endpoint then remains the source of truth.
    let transactionId = encryptedTransactionId;
    if (cfg.apiKey) transactionId = await decryptMonCashTransactionId(cfg.apiKey, encryptedTransactionId);

    const row = await env.DB.prepare(`SELECT m.*,s.first_name student_first_name,s.last_name student_last_name FROM moncash_payments m LEFT JOIN students s ON s.org_id=m.org_id AND s.student_code=m.student_id WHERE m.org_id=? AND m.moncash_transaction_id=? AND m.deleted_at IS NULL LIMIT 1`).bind(await resolveOrgId(env),transactionId).first();
    if (!row) {
      // A return can arrive before the transaction id was saved locally. The
      // only safe fallback is to verify by transaction id, then match the
      // returned order/reference against our pending rows.
      const body = await retrieveTransaction(cfg,transactionId);
      const details = paymentDetails(body);
      if (!details.reference) return new Response("Transaction MonCash sans référence.", {status:400});
      const pending = await env.DB.prepare(`SELECT m.*,s.first_name student_first_name,s.last_name student_last_name FROM moncash_payments m LEFT JOIN students s ON s.org_id=m.org_id AND s.student_code=m.student_id WHERE m.org_id=? AND m.order_id=? AND m.deleted_at IS NULL LIMIT 1`).bind(await resolveOrgId(env),details.reference).first();
      if (!pending) return new Response("Commande MonCash inconnue.", {status:404});
      const result = await applyVerifiedPayment(env,cfg,{...pending,_session_token:null},body,"return");
      return new Response(JSON.stringify(result),{status:200,headers:{"Content-Type":"application/json"}});
    }
    const body = await retrieveTransaction(cfg,transactionId);
    const result = await applyVerifiedPayment(env,cfg,{...row,_session_token:null},body,"return");
    return new Response(JSON.stringify(result),{status:200,headers:{"Content-Type":"application/json"}});
  } catch(e) {
    return new Response(JSON.stringify({success:false,error:e.message}),{status:502,headers:{"Content-Type":"application/json"}});
  }
}

// MonCash's historical middleware documentation specifies RSA/None/NoPadding
// with the merchant API public key, represented as a base64 DER public key.
// This small RSA implementation exists only for that server-side return value.
function readDer(bytes) {
  let o=0;
  function len(){let n=bytes[o++];if(n<128)return n;const c=n&127;let v=0;for(let i=0;i<c;i++)v=v*256+bytes[o++];return v;}
  function tlv(){const tag=bytes[o++],l=len(),start=o;o+=l;return {tag,start,end:o};}
  const toBigInt=(start,end)=>{let v=0n;for(let i=start;i<end;i++)v=(v<<8n)+BigInt(bytes[i]);return v;};
  const root=tlv();
  let cursor=root.start;
  const first=(() => { o=cursor; return tlv(); })();
  const second=(() => { o=first.end; return tlv(); })();
  // PKCS#1: SEQUENCE(INTEGER n, INTEGER e).
  if(first.tag===0x02 && second.tag===0x02) return {n:toBigInt(first.start,first.end),e:toBigInt(second.start,second.end)};
  // X.509 SubjectPublicKeyInfo: SEQUENCE(AlgorithmIdentifier, BIT STRING(RSAPublicKey)).
  if(first.tag===0x30 && second.tag===0x03){
    const bitStart=second.start+1;
    o=bitStart; const inner=tlv();
    o=inner.start; const nInt=tlv(); const eInt=tlv();
    return {n:toBigInt(nInt.start,nInt.end),e:toBigInt(eInt.start,eInt.end)};
  }
  throw new Error("Clé publique MonCash RSA non reconnue.");
}
function modPow(base, exp, mod){let r=1n%mod;let b=base%mod;let e=exp;while(e>0n){if(e&1n)r=(r*b)%mod;b=(b*b)%mod;e>>=1n;}return r;}
async function decryptMonCashTransactionId(apiKey, encrypted) {
  const der=unb64(apiKey);
  const {n,e}=readDer(der);
  const c=BigInt("0x"+Array.from(unb64(encrypted)).map(x=>x.toString(16).padStart(2,"0")).join(""));
  const m=modPow(c,e,n);
  const bytes=[];let x=m;while(x>0n){bytes.unshift(Number(x&255n));x>>=8n;}
  const k=Math.ceil(Number(n.toString(2).length)/8);while(bytes.length<k)bytes.unshift(0);
  // MonCash uses RSA/None/NoPadding. The payload may therefore contain
  // leading zeroes or a short UTF-8 transaction id. Strip only zero padding.
  let out=bytes.slice().filter((_,i)=>i>=bytes.findIndex(v=>v!==0));
  if(!out.length) out=bytes;
  return new TextDecoder().decode(new Uint8Array(out)).replace(/[\x00\x01\xff]+/g,"").trim();
}
