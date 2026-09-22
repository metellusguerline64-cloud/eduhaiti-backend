#!/usr/bin/env node
/**
 * EduHaïti Edge v2 — site-local persistent relay.
 *
 * Cloud = global authority.
 * Edge = local site relay + durable queue for idempotent syncPush batches.
 * Terminal = IndexedDB/offline-first authority for its own work.
 *
 * Only typed syncPush is queued when Cloud is unreachable. Other API calls
 * fail normally so we never replay a non-idempotent legacy action blindly.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const PORT = Number(process.env.EDU_EDGE_PORT || 8787);
const HOST = process.env.EDU_EDGE_HOST || '0.0.0.0';
const SITE_ID = String(process.env.EDU_EDGE_SITE_ID || 'SITE-LOCAL');
const EDGE_ID = String(process.env.EDU_EDGE_ID || `EDGE-${SITE_ID}`);
const CLOUD_BASE_URL = String(process.env.EDU_EDGE_CLOUD_URL || '').replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.EDU_EDGE_DATA_DIR || './.eduhaiti-edge');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const QUEUE_FILE = path.join(DATA_DIR, 'sync-queue.json');
const STORE_FILE = path.join(DATA_DIR, 'site-store.json');
const STORE_VERSION = 1;
const MAX_BODY = 16 * 1024 * 1024;
const RETRY_MS = Math.max(Number(process.env.EDU_EDGE_RETRY_MS || 15000), 5000);
const MAX_RETRIES = Math.max(Number(process.env.EDU_EDGE_MAX_RETRIES || 1000), 1);
const OFFLINE_SESSION_TTL_MS = Math.max(Number(process.env.EDU_EDGE_OFFLINE_SESSION_TTL_MS || 86400000), 60000);
const IDENTITY_FILE = path.join(DATA_DIR, 'identity-cache.json');
const DEVICE_REGISTRY_FILE = path.join(DATA_DIR, 'device-registry.json');
const CONFLICTS_FILE = path.join(DATA_DIR, 'conflicts.json');
const DEVICE_OFFLINE_TTL_MS = Math.max(Number(process.env.EDU_EDGE_DEVICE_OFFLINE_TTL_MS || 120000), 30000);
const COMPLETED_QUEUE_TTL_MS = Math.max(Number(process.env.EDU_EDGE_COMPLETED_QUEUE_TTL_MS || 7 * 86400000), 3600000);
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const MEDIA_QUEUE_FILE = path.join(DATA_DIR, 'media-queue.json');
const MEDIA_INDEX_FILE = path.join(DATA_DIR, 'media-index.json');
const MEDIA_COMPLETED_TTL_MS = Math.max(Number(process.env.EDU_EDGE_MEDIA_COMPLETED_TTL_MS || 30 * 86400000), 3600000);
const PROVISIONING_ENABLED = String(process.env.EDU_EDGE_PROVISIONING_ENABLED || 'true').toLowerCase() !== 'false';
const PROVISION_CODE = String(process.env.EDU_EDGE_PROVISION_CODE || '').trim();
const TLS_CERT_FILE = String(process.env.EDU_EDGE_TLS_CERT_FILE || '').trim();
const TLS_KEY_FILE = String(process.env.EDU_EDGE_TLS_KEY_FILE || '').trim();
const REQUIRE_HTTPS = String(process.env.EDU_EDGE_REQUIRE_HTTPS || 'false').toLowerCase() === 'true';
const ALLOWED_ORIGINS = String(process.env.EDU_EDGE_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
const REQUIRE_REGISTERED_DEVICE = String(process.env.EDU_EDGE_REQUIRE_REGISTERED_DEVICE || 'true').toLowerCase() !== 'false';
const REQUIRE_OFFLINE_AUTH = String(process.env.EDU_EDGE_REQUIRE_OFFLINE_AUTH || 'true').toLowerCase() !== 'false';
const MEDIA_BACKUP_MAX_BYTES = Math.max(Number(process.env.EDU_EDGE_MEDIA_BACKUP_MAX_BYTES || 512 * 1024 * 1024), 16 * 1024 * 1024);
const HEALTH_DISK_WARN_PCT = Math.min(Math.max(Number(process.env.EDU_EDGE_HEALTH_DISK_WARN_PCT || 85), 50), 99);
const HEALTH_DISK_CRITICAL_PCT = Math.min(Math.max(Number(process.env.EDU_EDGE_HEALTH_DISK_CRITICAL_PCT || 95), HEALTH_DISK_WARN_PCT + 1), 99.9);
const HEALTH_WATCHDOG_MS = Math.max(Number(process.env.EDU_EDGE_HEALTH_WATCHDOG_MS || 30000), 10000);
let healthState = { startedAt: Date.now(), lastCheckAt: null, lastSelfHealAt: null, lastSelfHeal: null, consecutiveErrors: 0 };
let selfHealRunning = false;
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(MEDIA_DIR, { recursive: true });

async function atomicWriteFile(file, data) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2,8)}.tmp`);
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, file);
}

let queue = await loadQueue();
let store = await loadStore();
let flushRunning = false;
let storePersistChain = Promise.resolve();
let cloudReachable = false;
let persistChain = Promise.resolve();
let identityCache = await loadIdentityCache();
let deviceRegistry = await loadJsonFile(DEVICE_REGISTRY_FILE, {version:1, siteId:SITE_ID, edgeId:EDGE_ID, devices:{}});
let conflictStore = await loadJsonFile(CONFLICTS_FILE, {version:1, siteId:SITE_ID, edgeId:EDGE_ID, items:{}});
let mediaQueue = await loadJsonFile(MEDIA_QUEUE_FILE, {version:1, siteId:SITE_ID, edgeId:EDGE_ID, items:[]});
let mediaIndex = await loadJsonFile(MEDIA_INDEX_FILE, {version:1, siteId:SITE_ID, edgeId:EDGE_ID, items:{}});
let mediaPersistChain = Promise.resolve();
let identityPersistChain = Promise.resolve();
let devicePersistChain = Promise.resolve();
let conflictPersistChain = Promise.resolve();


async function loadJsonFile(file, fallback) {
  try { const raw = await fs.readFile(file, 'utf8'); const parsed = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed : fallback; }
  catch (_) { return fallback; }
}
function persistMediaState() {
  const q = JSON.stringify(mediaQueue, null, 2), idx = JSON.stringify(mediaIndex, null, 2);
  mediaPersistChain = mediaPersistChain.then(async () => { await atomicWriteFile(MEDIA_QUEUE_FILE, q); await atomicWriteFile(MEDIA_INDEX_FILE, idx); }).catch(() => {});
  return mediaPersistChain;
}
function safeMediaKey(key) {
  const k = String(key || '');
  return k && !k.includes('\0') && !k.includes('..') && !k.startsWith('/') && !k.startsWith('\\') ? k : '';
}
function mediaFilePath(key) { return path.join(MEDIA_DIR, encodeURIComponent(String(key || '')) + '.bin'); }

async function loadIdentityCache() {
  try {
    const raw = await fs.readFile(IDENTITY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object'
      ? parsed
      : { version:1, siteId:SITE_ID, edgeId:EDGE_ID, entries:{} };
  } catch (_) { return { version:1, siteId:SITE_ID, edgeId:EDGE_ID, entries:{} }; }
}

function persistIdentityCache() {
  const snapshot = JSON.stringify(identityCache, null, 2);
  identityPersistChain = identityPersistChain.then(() => atomicWriteFile(IDENTITY_FILE, snapshot)).catch(() => {});
  return identityPersistChain;
}

async function tokenFingerprint(authorization) {
  const raw = String(authorization || '');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Buffer.from(digest).toString('hex');
}

async function cacheIdentityFromViewer(authorization, viewer) {
  if (!viewer?.success || !viewer.userId) return false;
  const fp = await tokenFingerprint(authorization);
  if (!fp) return false;
  const now = Date.now();
  identityCache.entries[fp] = {
    userId:String(viewer.userId), email:String(viewer.email || ''), role:String(viewer.role || ''),
    active:viewer.active !== false, permissions:viewer.permissions && typeof viewer.permissions === 'object' ? viewer.permissions : {},
    isTeacher:!!viewer.isTeacher, assignedSubjects:viewer.assignedSubjects && typeof viewer.assignedSubjects === 'object' ? viewer.assignedSubjects : {},
    isMaster:!!viewer.isMaster, isGodMode:!!viewer.isGodMode,
    cachedAt:now, expiresAt:now + OFFLINE_SESSION_TTL_MS
  };
  await persistIdentityCache();
  return true;
}

async function getCachedIdentity(authorization) {
  const fp = await tokenFingerprint(authorization);
  if (!fp) return null;
  const item = identityCache.entries[fp];
  if (!item || !item.active || Number(item.expiresAt || 0) < Date.now()) {
    if (item) { delete identityCache.entries[fp]; await persistIdentityCache(); }
    return null;
  }
  return item;
}


function persistDeviceRegistry() {
  const snapshot = JSON.stringify(deviceRegistry, null, 2);
  devicePersistChain = devicePersistChain.then(() => atomicWriteFile(DEVICE_REGISTRY_FILE, snapshot)).catch(() => {});
  return devicePersistChain;
}

function persistConflictStore() {
  const snapshot = JSON.stringify(conflictStore, null, 2);
  conflictPersistChain = conflictPersistChain.then(() => atomicWriteFile(CONFLICTS_FILE, snapshot)).catch(() => {});
  return conflictPersistChain;
}

function conflictKey(outcome, entry) {
  return String(outcome?.idempotencyKey || `${entry?.table || 'table'}:${entry?.id || ''}:${Date.now()}`);
}

async function recordConflict(outcome, entry, queueId) {
  if (!outcome || outcome.status !== 'conflict') return null;
  const id = conflictKey(outcome, entry);
  const previous = conflictStore.items[id] || {};
  const item = {
    id, siteId:SITE_ID, edgeId:EDGE_ID, queueId:queueId || previous.queueId || null,
    status:previous.status === 'resolved' ? previous.status : 'open',
    createdAt:previous.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString(),
    table:outcome.table || entry?.table || '', rowId:outcome.id || entry?.id || '',
    deviceId:entry?.deviceId || null, userId:entry?.userId || null,
    operation:entry?.op || null, baseVersion:Number(entry?.baseVersion || 0),
    businessKey:outcome.businessKey || null, canonicalId:outcome.canonicalId || null,
    serverVersion:Number(outcome.serverVersion || 0), serverUpdatedAt:outcome.serverUpdatedAt || null,
    localFields:entry?.fields || {}, serverRow:outcome.serverRow || null,
    reason:outcome.reason || outcome.message || 'Version ou clé métier en conflit.',
    resolution:previous.resolution || null, resolvedAt:previous.resolvedAt || null, resolvedBy:previous.resolvedBy || null
  };
  conflictStore.items[id]=item; await persistConflictStore(); return item;
}

function openConflicts() { return Object.values(conflictStore.items || {}).filter(x => x && x.status !== 'resolved'); }

function deviceIdFrom(body, req) {
  return String(body?.deviceId || body?.data?.deviceId || req?.headers?.['x-eduhaiti-device-id'] || '').trim().slice(0,160);
}

async function registerDevice(req, body, identity, status='online') {
  const deviceId = deviceIdFrom(body, req);
  if (!deviceId || !identity) return null;
  const now = new Date().toISOString();
  const previous = deviceRegistry.devices[deviceId] || {};
  const item = {
    deviceId, siteId:SITE_ID, edgeId:EDGE_ID, userId:identity.userId, email:identity.email || '', role:identity.role || '',
    isMaster:!!identity.isMaster, isGodMode:!!identity.isGodMode, status, firstSeenAt:previous.firstSeenAt || now,
    lastSeenAt:now, lastSyncAt: status === 'online' ? now : (previous.lastSyncAt || null),
    lastIp:req?.socket?.remoteAddress || previous.lastIp || null, revoked:!!previous.revoked, revokedAt:previous.revokedAt || null,
    tokenFingerprint: await tokenFingerprint(req?.headers?.authorization || '')
  };
  if (item.revoked) item.status='revoked';
  deviceRegistry.devices[deviceId] = item;
  await persistDeviceRegistry();
  await logEvent('device_registered',{deviceId,userId:identity.userId,status:item.status});
  return item;
}

function getRegisteredDevice(deviceId) { return deviceRegistry.devices[String(deviceId || '')] || null; }

async function requireDevice(req, identity, body=null, allowUnregistered=true) {
  const deviceId=deviceIdFrom(body,req);
  if (!deviceId) return {ok:allowUnregistered, device:null, deviceId:''};
  const d=getRegisteredDevice(deviceId);
  if (d?.revoked) return {ok:false,error:'Terminal révoqué.',device:d,deviceId};
  if (d && d.userId !== identity.userId && !identity.isMaster && !identity.isGodMode) return {ok:false,error:'Terminal associé à un autre utilisateur.',device:d,deviceId};
  if (!d && allowUnregistered) return {ok:true,device:null,deviceId};
  return {ok:!!d,device:d,deviceId};
}

function deviceStatus(item) {
  if (!item) return 'unknown';
  if (item.revoked) return 'revoked';
  return (Date.now() - Date.parse(item.lastSeenAt || 0) <= DEVICE_OFFLINE_TTL_MS) ? 'online' : 'offline';
}

function permissionAllowed(identity, required) {
  if (!identity) return false;
  if (identity.isMaster || identity.isGodMode) return true;
  const perms = identity.permissions || {};
  const keys = Array.isArray(required) ? required : (required ? [required] : []);
  return !keys.length || keys.some(k => perms[k] === true || perms[k] === 1 || perms[k] === '1');
}

const SYNC_TABLE_PERMISSIONS = {
  students: { read:['p_dossier','pt_view_student_profile'], write:['pa_add_student','pa_edit_student','p_dossier'] },
  grades: { read:['p_grades','pt_view_student_profile','pt_enter_grades','pt_edit_grades'], write:['pt_enter_grades','pt_edit_grades','p_grades'] },
  payments: { read:['p_finance','pa_record_payment'], write:['pa_record_payment','p_finance'] },
  attendance: { read:['p_attendance','pt_view_attendance'], write:['pt_mark_attendance','p_attendance'] },
  timetable: { read:['p_staff','pa_teacher_affectation','p_settings'], write:['pa_teacher_affectation','p_settings'] },
  teacher_assignments: { read:['p_staff','pa_teacher_affectation'], write:['pa_teacher_affectation','p_settings'] }
};

function syncEntryPermission(identity, entry) {
  if (!identity) return {ok:false,error:'Session locale absente.'};
  if (identity.isMaster || identity.isGodMode) return {ok:true};
  const table=String(entry?.table||'').trim();
  const rules=SYNC_TABLE_PERMISSIONS[table];
  if (!rules) return {ok:false,error:`Domaine hors ligne non autorisé: ${table || 'inconnu'}.`};
  const op=String(entry?.op||'upsert').toLowerCase();
  const required=(op==='delete' ? rules.write : rules.write);
  if (!permissionAllowed(identity,required)) return {ok:false,error:`Permission insuffisante pour synchroniser ${table}.`};
  return {ok:true};
}

const LOCAL_ACTION_PERMISSIONS = {
  getViewerInfo: [],
  getStudents: ['p_dossier','pa_add_student','pa_edit_student','pt_view_class_list','pt_view_student_profile','pt_view_history','pt_view_photo','pt_view_contact','pt_mark_attendance','pt_view_attendance','pt_enter_grades','pt_edit_grades','pt_view_bulletin','pt_view_class_perf','pt_view_ranking'],
  getGrades: ['p_grades','pt_view_class_list','pt_view_student_profile','pt_view_history','pt_view_photo','pt_view_contact','pt_mark_attendance','pt_view_attendance','pt_enter_grades','pt_edit_grades','pt_view_bulletin','pt_view_class_perf','pt_view_ranking'],
  getPayments: ['p_finance','pa_record_payment'],
  getAttendance: ['p_attendance','pt_view_attendance','pt_mark_attendance'],
  getStudentAttendance: ['p_attendance','pt_view_attendance','pt_mark_attendance'],
  getAttendanceForStudent: ['p_attendance','pt_view_attendance','pt_mark_attendance'],
  getTimetableData: ['p_staff','pa_teacher_affectation','p_settings'],
  getStaffAssignments: ['p_staff','pa_teacher_affectation','pt_view_class_list','pt_view_student_profile','pt_view_history','pt_view_photo','pt_view_contact','pt_mark_attendance','pt_view_attendance','pt_enter_grades','pt_edit_grades','pt_view_bulletin','pt_view_class_perf','pt_view_ranking']
};

async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === STORE_VERSION && parsed.tables && typeof parsed.tables === 'object') return parsed;
  } catch (_) {}
  return { version: STORE_VERSION, siteId: SITE_ID, edgeId: EDGE_ID, tables: {}, cursors: {}, updatedAt: null };
}

function persistStore() {
  const snapshot = JSON.stringify(store, null, 2);
  storePersistChain = storePersistChain.then(() => atomicWriteFile(STORE_FILE, snapshot)).catch(() => {});
  return storePersistChain;
}

function storeTable(table) {
  if (!store.tables[table]) store.tables[table] = {};
  return store.tables[table];
}

function storeUpsert(table, row) {
  if (!row || !row.id) return;
  storeTable(table)[String(row.id)] = { ...row, cachedAt: new Date().toISOString() };
}

function storeApplyRows(table, rows, cursor) {
  for (const row of rows || []) {
    if (!row?.id) continue;
    if (row.deleted || row.deletedAt) {
      storeTable(table)[String(row.id)] = { ...row, deleted: true, cachedAt: new Date().toISOString() };
    } else {
      storeUpsert(table, row);
    }
  }
  if (cursor) store.cursors[table] = cursor;
  store.updatedAt = new Date().toISOString();
}

function localDelta(table, cursor, limit = 500) {
  const rawCursor = String(cursor || '1970-01-01T00:00:00.000Z');
  const sep = rawCursor.lastIndexOf('|');
  const since = sep > 0 ? rawCursor.slice(0, sep) : rawCursor;
  const sinceId = sep > 0 ? rawCursor.slice(sep + 1) : '';
  const rows = Object.values(store.tables[table] || {})
    .filter(r => r && (r.updatedAt || r.updated_at) && ((r.updatedAt || r.updated_at) > since || ((r.updatedAt || r.updated_at) === since && String(r.id) > sinceId)))
    .sort((a,b) => String(a.updatedAt || a.updated_at).localeCompare(String(b.updatedAt || b.updated_at)) || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.min(Math.max(Number(limit) || 500, 1), 2000));
  const nextCursor = rows.length ? `${rows.at(-1).updatedAt || rows.at(-1).updated_at}|${rows.at(-1).id}` : rawCursor;
  return { table, rows: rows.map(r => ({...r, updatedAt:r.updatedAt || r.updated_at, deletedAt:r.deletedAt || r.deleted_at || null, deleted:!!(r.deleted || r.deletedAt || r.deleted_at)})), cursor: nextCursor, hasMore: rows.length === Math.min(Math.max(Number(limit) || 500, 1), 2000) };
}

function applyLocalEntry(entry) {
  const table = String(entry?.table || '');
  if (!table || !entry?.id) return;
  const fields = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
  const existing = storeTable(table)[String(entry.id)] || {};
  const ts = new Date().toISOString();
  const version = Math.max(Number(existing.version || 0) + 1, Number(entry.baseVersion || 0) + 1);
  if (entry.op === 'delete') {
    storeTable(table)[String(entry.id)] = { ...existing, id:String(entry.id), version, updatedAt:ts, deletedAt:ts, deleted:true, cachedAt:ts };
  } else if (entry.op === 'upsert') {
    storeTable(table)[String(entry.id)] = { ...existing, id:String(entry.id), version, ...fields, fields, updatedAt:ts, deletedAt:null, deleted:false, cachedAt:ts };
  }
  store.updatedAt = ts;
}

async function loadQueue() {
  try {
    const raw = await fs.readFile(QUEUE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function persistQueue() {
  const snapshot = JSON.stringify(queue, null, 2);
  persistChain = persistChain.then(() => atomicWriteFile(QUEUE_FILE, snapshot)).catch(() => {});
  return persistChain;
}

function cors(req, res) {
  const origin = String(req.headers.origin || '');
  const allowed = !ALLOWED_ORIGINS.length || !origin || ALLOWED_ORIGINS.includes(origin);
  if (allowed && origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Eduhaiti-Edge-Id, X-Eduhaiti-Site-Id, X-Eduhaiti-Device-Id');
  return allowed;
}
function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
async function readBody(req, maxBytes=MAX_BODY) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Corps de requête trop volumineux.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function logEvent(kind, data) {
  const row = { ts: new Date().toISOString(), kind, siteId: SITE_ID, edgeId: EDGE_ID, ...data };
  await fs.appendFile(EVENTS_FILE, JSON.stringify(row) + '\n', 'utf8').catch(() => {});
}

async function readAuditEvents(limit=100, kind='') {
  let raw='';
  try { raw=await fs.readFile(EVENTS_FILE,'utf8'); } catch (_) { return []; }
  const max=Math.min(Math.max(Number(limit)||100,1),500);
  const wanted=String(kind||'').trim();
  const lines=raw.split(/\r?\n/).filter(Boolean);
  const out=[];
  for(let i=lines.length-1;i>=0 && out.length<max;i--){
    try{
      const e=JSON.parse(lines[i]);
      if(wanted && String(e.kind||'')!==wanted) continue;
      // Never expose authorization/token-like fields through the audit API.
      delete e.authorization; delete e.token; delete e.accessToken; delete e.refreshToken; delete e.tokenFingerprint;
      out.push(e);
    }catch(_){ /* ignore malformed historical lines */ }
  }
  return out;
}

function adminIdentity(identity) {
  return !!identity && (identity.isMaster || identity.isGodMode || permissionAllowed(identity, ['p_settings','pa_manage_users']));
}

function backupSnapshot() {
  // Deliberately exclude identity-cache token fingerprints. A backup must not
  // become a portable authentication credential.
  const devices = Object.fromEntries(Object.entries(deviceRegistry.devices || {}).map(([id, d]) => {
    const safe = { ...d }; delete safe.tokenFingerprint; return [id, safe];
  }));
  return {
    backupVersion: 1,
    kind: 'eduhaiti-edge-operational-backup',
    siteId: SITE_ID,
    edgeId: EDGE_ID,
    createdAt: new Date().toISOString(),
    note: 'Les fichiers média binaires du dossier media/ ne sont pas inclus dans cet export JSON.',
    store,
    queue,
    mediaQueue,
    mediaIndex,
    conflictStore,
    deviceRegistry: { version: deviceRegistry.version || 1, siteId: SITE_ID, edgeId: EDGE_ID, devices },
  };
}

function validateBackup(data) {
  if (!data || data.kind !== 'eduhaiti-edge-operational-backup' || Number(data.backupVersion) !== 1) return 'Format de sauvegarde Edge invalide.';
  if (String(data.siteId || '') !== SITE_ID) return `La sauvegarde appartient au site ${data.siteId || 'inconnu'}, pas à ${SITE_ID}.`;
  if (!data.store || typeof data.store !== 'object' || !data.queue || !Array.isArray(data.queue)) return 'Sauvegarde incomplète : store ou file de synchronisation manquante.';
  if (!data.mediaQueue || typeof data.mediaQueue !== 'object' || !data.mediaIndex || typeof data.mediaIndex !== 'object') return 'Sauvegarde incomplète : état média manquant.';
  if (!data.conflictStore || typeof data.conflictStore !== 'object') return 'Sauvegarde incomplète : conflits manquants.';
  return null;
}

async function restoreSnapshot(data) {
  const safeDevices = {};
  for (const [id, d] of Object.entries(data.deviceRegistry?.devices || {})) {
    if (!d || typeof d !== 'object') continue;
    const safe = { ...d };
    delete safe.tokenFingerprint;
    safeDevices[String(id)] = safe;
  }
  store = data.store;
  queue = Array.isArray(data.queue) ? data.queue : [];
  mediaQueue = data.mediaQueue;
  mediaIndex = data.mediaIndex;
  conflictStore = data.conflictStore;
  deviceRegistry = { version:1, siteId:SITE_ID, edgeId:EDGE_ID, devices:safeDevices };
  await Promise.all([persistStore(), persistQueue(), persistMediaState(), persistConflictStore(), persistDeviceRegistry()]);
}



function tarOctal(value, length) {
  const n = Math.max(0, Number(value) || 0);
  const oct = n.toString(8).padStart(length - 1, '0');
  return Buffer.from(oct.slice(-(length - 1)) + '\0', 'ascii');
}
function tarHeader(name, size, mode=0o644) {
  const h = Buffer.alloc(512, 0);
  const n = Buffer.from(String(name).slice(0,100), 'utf8'); n.copy(h,0);
  tarOctal(mode,8).copy(h,100); tarOctal(0,8).copy(h,108); tarOctal(0,8).copy(h,116);
  tarOctal(size,12).copy(h,124); tarOctal(Math.floor(Date.now()/1000),12).copy(h,136);
  h[156]=48; Buffer.from('ustar\0','ascii').copy(h,257); Buffer.from('00','ascii').copy(h,263);
  h.fill(32,148,156); let sum=0; for(const b of h) sum+=b; tarOctal(sum,8).copy(h,148); return h;
}
function pad512(n) { return (512 - (n % 512)) % 512; }
function buildTar(entries) {
  const chunks=[];
  for (const e of entries) { const data=Buffer.isBuffer(e.data)?e.data:Buffer.from(e.data); chunks.push(tarHeader(e.name,data.length),data,Buffer.alloc(pad512(data.length))); }
  chunks.push(Buffer.alloc(1024)); return Buffer.concat(chunks);
}
function readTar(tar) {
  const files=[]; let off=0;
  while(off+512<=tar.length){
    const h=tar.subarray(off,off+512); const empty=h.every(b=>b===0); if(empty) break;
    const name=h.subarray(0,100).toString('utf8').replace(/\0.*$/,'');
    const sizeText=h.subarray(124,136).toString('ascii').replace(/\0/g,'').trim(); const size=parseInt(sizeText||'0',8);
    if(!name || !Number.isFinite(size) || size<0 || off+512+size>tar.length) throw new Error('Archive média corrompue.');
    files.push({name,data:Buffer.from(tar.subarray(off+512,off+512+size))}); off += 512 + size + pad512(size);
  }
  return files;
}
function mediaBackupManifest() {
  const files=[];
  for (const [fileKey,item] of Object.entries(mediaIndex.items||{})) {
    const safe=safeMediaKey(fileKey); if(!safe) continue;
    const pth=mediaFilePath(safe); files.push({fileKey:safe,name:item?.name||safe,mimeType:item?.mimeType||'application/octet-stream',size:Number(item?.size||0),status:item?.status||'unknown',updatedAt:item?.updatedAt||null,path:`media/${encodeURIComponent(safe)}.bin`});
  }
  return {backupVersion:1,kind:'eduhaiti-edge-media-backup',siteId:SITE_ID,edgeId:EDGE_ID,createdAt:new Date().toISOString(),media:files};
}
async function buildMediaBackupArchive() {
  const manifest=mediaBackupManifest(); const entries=[{name:'manifest.json',data:JSON.stringify(manifest,null,2)}]; let total=entries[0].data.length;
  for(const f of manifest.media){
    try { const data=await fs.readFile(mediaFilePath(f.fileKey)); if(data.length>MEDIA_BACKUP_MAX_BYTES || total+data.length>MEDIA_BACKUP_MAX_BYTES) throw new Error('Taille maximale de sauvegarde média dépassée.'); entries.push({name:f.path,data}); total+=data.length; } catch(e) { if(e?.code==='ENOENT') continue; throw e; }
  }
  const gz=await gzipAsync(buildTar(entries)); if(gz.length>MEDIA_BACKUP_MAX_BYTES) throw new Error('Archive média trop volumineuse.'); return {archive:gz,manifest,bytes:gz.length};
}
async function inspectMediaBackupArchive(buffer) {
  const tar=await gunzipAsync(buffer); const files=readTar(tar); const mf=files.find(x=>x.name==='manifest.json'); if(!mf) throw new Error('Manifest média manquant.');
  let manifest; try{manifest=JSON.parse(mf.data.toString('utf8'));}catch{throw new Error('Manifest média invalide.');}
  if(manifest.kind!=='eduhaiti-edge-media-backup' || Number(manifest.backupVersion)!==1) throw new Error('Format de sauvegarde média invalide.');
  if(String(manifest.siteId||'')!==SITE_ID) throw new Error(`La sauvegarde média appartient au site ${manifest.siteId||'inconnu'}, pas à ${SITE_ID}.`);
  if(!Array.isArray(manifest.media)) throw new Error('Manifest média incomplet.');
  return {files,manifest};
}
async function restoreMediaBackupArchive(buffer) {
  if(buffer.length>MEDIA_BACKUP_MAX_BYTES) throw new Error('Archive média trop volumineuse.');
  const {files,manifest}=await inspectMediaBackupArchive(buffer); const byName=new Map(files.map(x=>[x.name,x.data])); let restored=0, skipped=0;
  for(const item of manifest.media){
    const key=safeMediaKey(item.fileKey); if(!key || !/^media\//.test(item.path||'')) { skipped++; continue; }
    const data=byName.get(item.path); if(!data) { skipped++; continue; }
    await fs.writeFile(mediaFilePath(key),data);
    const prev=mediaIndex.items[key]||{}; mediaIndex.items[key]={...prev,fileKey:key,name:item.name||prev.name||key,mimeType:item.mimeType||prev.mimeType||'application/octet-stream',size:data.length,status:prev.status||item.status||'restored',updatedAt:new Date().toISOString(),restoredAt:new Date().toISOString()}; restored++;
  }
  await persistMediaState(); return {restored,skipped,total:manifest.media.length,siteId:SITE_ID,edgeId:EDGE_ID};
}

function cloudTarget(reqUrl) {
  return new URL(reqUrl, CLOUD_BASE_URL);
}

function forwardedHeaders(req) {
  const headers = new Headers();
  for (const [k,v] of Object.entries(req.headers)) {
    if (!v || ['host','content-length','connection'].includes(k.toLowerCase())) continue;
    headers.set(k, Array.isArray(v) ? v.join(',') : v);
  }
  headers.set('X-Eduhaiti-Edge-Id', EDGE_ID);
  headers.set('X-Eduhaiti-Site-Id', SITE_ID);
  return headers;
}

async function proxy(req, res, body) {
  if (!CLOUD_BASE_URL) return json(res, { success:false, error:'EDU_EDGE_CLOUD_URL non configurée.' }, 503);
  const target = cloudTarget(req.url);
  const r = await fetch(target, {
    method:req.method,
    headers:forwardedHeaders(req),
    body: body?.length ? body : undefined,
    signal: AbortSignal.timeout(12000)
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const action = target.searchParams.get('action') || (() => { try { return JSON.parse(body?.toString('utf8') || '{}')?.action || ''; } catch { return ''; } })();
  if (r.ok && action === 'getViewerInfo') {
    try { const viewer = JSON.parse(buf.toString('utf8')); await cacheIdentityFromViewer(req.headers.authorization, viewer); } catch (_) {}
  }
  res.statusCode = r.status;
  r.headers.forEach((v,k) => { if (!['transfer-encoding','content-encoding','content-length'].includes(k.toLowerCase())) res.setHeader(k,v); });
  res.end(buf);
}

function isSyncPush(req, parsedBody) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return u.searchParams.get('action') === 'syncPush' || parsedBody?.action === 'syncPush';
}

function queueKey(body) {
  const entries = Array.isArray(body?.data?.entries) ? body.data.entries : [];
  return entries.map(e => String(e?.idempotencyKey || '')).filter(Boolean).join('|');
}

async function enqueueSyncPush(req, body) {
  const entries = Array.isArray(body?.data?.entries) ? body.data.entries : [];
  if (!entries.length) throw new Error('Aucune entrée à synchroniser.');
  const requestedSiteId=String(body?.data?.siteId || body?.siteId || '').trim();
  if (requestedSiteId && requestedSiteId !== SITE_ID) throw new Error(`Site Edge incorrect: ${requestedSiteId}.`);
  const authorization=String(req.headers.authorization||'').trim();
  const fp=await tokenFingerprint(authorization);
  const identity=fp ? identityCache.entries[fp] : null;
  if (REQUIRE_OFFLINE_AUTH && !identity) throw new Error('Session Edge absente ou expirée. Reconnectez-vous au Cloud/Edge avec Internet.');
  if (identity) {
    if (!identity.active || Number(identity.expiresAt||0) < Date.now()) throw new Error('Session Edge expirée.');
    const deviceCheck=await requireDevice(req,identity,body,!REQUIRE_REGISTERED_DEVICE);
    if (!deviceCheck.ok) throw new Error(deviceCheck.error||'Terminal non autorisé.');
    for (const entry of entries) {
      const check=syncEntryPermission(identity,entry);
      if (!check.ok) throw new Error(check.error);
    }
  }
  
  const keys = entries.map(e => String(e?.idempotencyKey || '')).filter(Boolean);
  if (keys.length !== entries.length) throw new Error('Une ou plusieurs entrées n’ont pas de clé d’idempotence.');
  // A conflict resolved as "cloud" must retire the terminal's old outbox entry
  // when it comes back later. Cloud remains authoritative; Edge only records the
  // user's explicit discard decision and returns a terminal-safe outcome.
  const resolvedCloud = entries.map(e => conflictStore.items[String(e?.idempotencyKey || '')]).filter(x => x && x.status === 'resolved' && x.resolution === 'cloud');
  if (resolvedCloud.length === entries.length) {
    return { entries, key: queueKey(body), queueId: null, existing: { lastResult: { success:true, outcomes:entries.map(e=>({idempotencyKey:e.idempotencyKey,id:e.id,table:e.table,status:'discarded_conflict',resolution:'cloud'})) } }, completed:true };
  }
  if (identity) await registerDevice(req, body, identity, 'online');

  const key = queueKey(body);
  const existing = queue.find(x => x.key === key);
  // Idempotent replay: if Cloud already accepted this batch, return the
  // authoritative stored result instead of enqueueing/replaying it again.
  if (existing?.status === 'applied') {
    return { entries, key, queueId: existing.id, existing, completed: true };
  }
  if (!existing) {
    queue.push({
      id: `edgeq_${Date.now()}_${Math.random().toString(36).slice(2,10)}`,
      key,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      deviceId: body?.data?.deviceId || null,
      entryCount: entries.length,
      request: {
        path: new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname + new URL(req.url, `http://${req.headers.host || 'localhost'}`).search,
        authorization: req.headers.authorization || null,
        body
      }
    });
    for (const entry of entries) applyLocalEntry(entry);
    await persistStore();
    await persistQueue();
    await logEvent('sync_queued', { queueId: queue.at(-1).id, deviceId: body?.data?.deviceId || null, entryCount: entries.length });
  }
  return { entries, key, queueId: (existing || queue.find(x => x.key === key)).id, existing: existing || null, completed: false };
}

function queuedOutcomes(entries, queueId) {
  return entries.map(e => ({
    idempotencyKey: e.idempotencyKey,
    id: e.id,
    table: e.table,
    status: 'queued',
    edgeQueueId: queueId
  }));
}

async function pushQueueItem(item) {
  if (!CLOUD_BASE_URL) return false;
  const reqData = item.request;
  const target = new URL(reqData.path, CLOUD_BASE_URL);
  const headers = new Headers({ 'Content-Type':'application/json', 'Accept':'application/json' });
  if (reqData.authorization) headers.set('Authorization', reqData.authorization);
  headers.set('X-Eduhaiti-Edge-Id', EDGE_ID);
  headers.set('X-Eduhaiti-Site-Id', SITE_ID);
  try {
    const r = await fetch(target, { method:'POST', headers, body:JSON.stringify(reqData.body), signal:AbortSignal.timeout(12000) });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = { success:false, error:text || `HTTP ${r.status}` }; }
    if (!r.ok || body?.success === false) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.updatedAt = new Date().toISOString();
      item.lastError = body?.error || `HTTP ${r.status}`;
      if (item.attempts >= MAX_RETRIES && r.status >= 400 && r.status < 500) item.status = 'failed';
      return false;
    }
    cloudReachable = true;
    // Cloud is authoritative. Reconcile successful outcomes into the local
    // site store so subsequent offline syncPull requests can be served locally.
    const outcomes = Array.isArray(body?.outcomes) ? body.outcomes : [];
    const byKey = new Map((reqData.body?.data?.entries || []).map(e => [e.idempotencyKey, e]));
    for (const outcome of outcomes) {
      const original = byKey.get(outcome?.idempotencyKey);
      if (!original) continue;
      if (outcome?.status === 'conflict') {
        await recordConflict(outcome, original, item.id);
        continue;
      }
      if (['applied','already_applied','duplicate'].includes(outcome?.status)) {
        if (outcome.status === 'duplicate' && outcome.canonicalId) {
          // Keep the local row as a tombstone; the next Cloud pull supplies the canonical row.
          storeTable(original.table)[String(original.id)] = { id:String(original.id), version:Number(outcome.serverVersion || 1), updatedAt:outcome.serverUpdatedAt || new Date().toISOString(), deleted:true, deletedAt:outcome.serverUpdatedAt || new Date().toISOString(), cachedAt:new Date().toISOString() };
        } else {
          applyLocalEntry(original);
          const local = storeTable(original.table)[String(original.id)];
          if (outcome.version) local.version = Number(outcome.version);
          if (outcome.updatedAt) local.updatedAt = outcome.updatedAt;
        }
      }
    }
    await persistStore();
    item.status = 'applied';
    item.completedAt = new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    item.lastResult = body;
    await logEvent('sync_flushed', { queueId:item.id, attempts:item.attempts, entryCount:item.entryCount });
    return true;
  } catch (e) {
    cloudReachable = false;
    item.attempts = Number(item.attempts || 0) + 1;
    item.updatedAt = new Date().toISOString();
    item.lastError = e?.message || String(e);
    return false;
  }
}

async function enqueueMediaUpload(req, body, identity) {
  if (!identity) throw new Error('Session Edge hors connexion invalide.');
  const data = body?.data || {};
  const content = String(data.contentBase64 || '');
  if (!content) throw new Error('contentBase64 requis');
  const raw = content.includes(',') ? content.split(',').pop() : content;
  const bytes = Buffer.from(raw, 'base64');
  if (!bytes.length) throw new Error('Fichier média vide.');
  if (bytes.length > MAX_BODY) throw new Error('Fichier média trop volumineux.');
  const id = String(data.clientMediaId || data.id || `edge_media_${Date.now()}_${Math.random().toString(36).slice(2,10)}`);
  const existing = mediaQueue.items.find(x => x.id === id);
  if (existing) return existing;
  const orgKey = String(data.orgId || SITE_ID).replace(/[^a-zA-Z0-9_-]/g,'_');
  const fileKey = `${orgKey}/${Date.now()}-${Math.random().toString(36).slice(2,10)}-${String(data.name || 'fichier').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}`;
  const localPath = mediaFilePath(fileKey);
  await fs.writeFile(localPath, bytes);
  const item = {
    id, fileKey, localPath, name:String(data.name || 'fichier'), mimeType:String(data.mimeType || 'application/octet-stream'), size:bytes.length,
    media:data.media && typeof data.media === 'object' ? data.media : {}, authorization:req.headers.authorization || null,
    userId:identity.userId, deviceId:String(data.deviceId || ''), status:'pending', attempts:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), cloudUpload:null, lastError:null
  };
  mediaQueue.items.push(item);
  mediaIndex.items[fileKey] = { id, fileKey, name:item.name, mimeType:item.mimeType, size:item.size, status:'pending', createdAt:item.createdAt, updatedAt:item.updatedAt, media:item.media };
  await persistMediaState();
  await logEvent('media_queued', {mediaId:id, fileKey, size:item.size, deviceId:item.deviceId});
  return item;
}
function mediaPermission(identity) { return permissionAllowed(identity, ['p_media','pa_save_settings','pt_build_exam','p_manual','p_build']); }
async function pushMediaItem(item) {
  if (!CLOUD_BASE_URL || !item?.authorization) return false;
  const localPath = item.localPath || mediaFilePath(item.fileKey);
  let bytes; try { bytes = await fs.readFile(localPath); } catch (e) { item.status='failed'; item.lastError='Fichier Edge introuvable: '+e.message; return false; }
  try {
    if (!item.cloudUpload?.fileId) {
      const contentBase64 = bytes.toString('base64');
      const target = new URL('/?action=uploadMediaFile', CLOUD_BASE_URL);
      const r = await fetch(target, {method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':item.authorization,'X-Eduhaiti-Edge-Id':EDGE_ID,'X-Eduhaiti-Site-Id':SITE_ID}, body:JSON.stringify({action:'uploadMediaFile',data:{name:item.name,mimeType:item.mimeType,contentBase64}}), signal:AbortSignal.timeout(20000)});
      const b = await r.json().catch(()=>null);
      if (!r.ok || !b || b.success===false) throw new Error(b?.error || `uploadMediaFile HTTP ${r.status}`);
      item.cloudUpload={fileId:b.fileId||'',url:b.url||'',viewUrl:b.viewUrl||b.url||'',size:Number(b.size||item.size||0)};
      await persistMediaState();
    }
    const media=Object.assign({}, item.media || {}, {id:(item.media||{}).id || item.id, file_id:item.cloudUpload.fileId, url:item.cloudUpload.url, mime:item.mimeType, size_bytes:Number(item.cloudUpload.size||item.size), _offlinePending:false, updated_at:new Date().toISOString()});
    const target2=new URL('/?action=saveMedia', CLOUD_BASE_URL);
    const r2=await fetch(target2,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Authorization':item.authorization,'X-Eduhaiti-Edge-Id':EDGE_ID,'X-Eduhaiti-Site-Id':SITE_ID},body:JSON.stringify({action:'saveMedia',data:{media}}),signal:AbortSignal.timeout(12000)});
    const b2=await r2.json().catch(()=>null);
    if(!r2.ok || !b2 || b2.success===false) throw new Error(b2?.error || `saveMedia HTTP ${r2.status}`);
    item.status='applied'; item.completedAt=new Date().toISOString(); item.updatedAt=item.completedAt; item.lastError=null;
    mediaIndex.items[item.fileKey]=Object.assign({}, mediaIndex.items[item.fileKey], {status:'applied', cloudFileId:item.cloudUpload.fileId, cloudUrl:item.cloudUpload.url, updatedAt:item.updated_at || new Date().toISOString(), media});
    await fs.unlink(localPath).catch(()=>{});
    await logEvent('media_flushed',{mediaId:item.id,fileKey:item.fileKey,deviceId:item.deviceId});
    return true;
  } catch(e) { item.attempts=Number(item.attempts||0)+1; item.updatedAt=new Date().toISOString(); item.lastError=e?.message||String(e); return false; }
}
async function flushMediaQueue() {
  if (!CLOUD_BASE_URL) return;
  for (const item of mediaQueue.items.filter(x=>x.status==='pending').slice(0,5)) await pushMediaItem(item);
  const cutoff=Date.now()-MEDIA_COMPLETED_TTL_MS;
  mediaQueue.items=mediaQueue.items.filter(x=>x.status!=='applied' || Date.parse(x.completedAt||x.updatedAt||x.createdAt||0)>=cutoff);
  await persistMediaState();
}

async function flushQueue() {
  if (flushRunning || !CLOUD_BASE_URL || !queue.length) return;
  flushRunning = true;
  try {
    for (const item of queue.filter(x => x.status === 'pending').slice(0, 20)) {
      await pushQueueItem(item);
    }
    const cutoff = Date.now() - COMPLETED_QUEUE_TTL_MS;
    queue = queue.filter(x => x.status !== 'applied' || Date.parse(x.completedAt || x.updatedAt || x.createdAt || 0) >= cutoff);
    await persistQueue();
  } finally { flushRunning = false; }
}

setInterval(() => { flushQueue().catch(() => {}); flushMediaQueue().catch(() => {}); }, RETRY_MS).unref();
flushQueue().catch(() => {});
flushMediaQueue().catch(() => {});

function buildDiscoveryManifest(req, includeProvisioning) {
  const host = String(req.headers.host || `localhost:${PORT}`);
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const edgeUrl = `${proto}://${host}`;
  return {
    success:true, protocol:'eduhaiti-edge-discovery-v1', mode:'edge-first-v2',
    siteId:SITE_ID, edgeId:EDGE_ID, edgeUrl,
    cloudConfigured:!!CLOUD_BASE_URL,
    endpoints:{audit:'/edge/audit',health:'/edge/health',discovery:'/edge/discovery',provision:'/edge/provision',localApi:'/edge/local-api',media:'/edge/media',syncStatus:'/edge/sync-status',devices:'/edge/devices',registerDevice:'/edge/devices/register',revokeDevice:'/edge/devices/revoke',mediaBackupExport:'/edge/media-backup/export',mediaBackupInspect:'/edge/media-backup/inspect',mediaBackupRestore:'/edge/media-backup/restore'},
    capabilities:{sameOriginDiscovery:true,localBusinessApi:true,mediaOffline:true,bidirectionalSync:true,provisioning:!!includeProvisioning,mediaBackup:true},
    security:{httpsRequired:REQUIRE_HTTPS,httpsConfigured:!!(TLS_CERT_FILE&&TLS_KEY_FILE),registeredDeviceRequired:REQUIRE_REGISTERED_DEVICE,allowedOrigins:ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : ['*']},
    provisioning: includeProvisioning ? {method:'POST',header:'X-Eduhaiti-Provision-Code',codeRequired:!!PROVISION_CODE} : {available:PROVISIONING_ENABLED}
  };
}

async function inspectDisk() {
  try {
    const stat = await fs.statfs(DATA_DIR);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    const used = Math.max(total - free, 0);
    const usedPct = total ? (used / total) * 100 : 0;
    return {available:true,totalBytes:total,freeBytes:free,usedBytes:used,usedPct:Number(usedPct.toFixed(2)),level:usedPct>=HEALTH_DISK_CRITICAL_PCT?'critical':usedPct>=HEALTH_DISK_WARN_PCT?'warning':'ok'};
  } catch (e) { return {available:false,error:e?.message||String(e),level:'unknown'}; }
}
function fileAgeMs(file) { try { return Date.now() - Number(file?.mtimeMs || 0); } catch (_) { return 0; } }
async function inspectFile(file) {
  try { const st=await fs.stat(file); return {exists:true,bytes:st.size,mtimeMs:st.mtimeMs}; }
  catch (_) { return {exists:false,bytes:0,mtimeMs:0}; }
}
async function runSelfHeal(reason='manual') {
  if (selfHealRunning) return {success:true,skipped:true,reason:'already-running'};
  selfHealRunning=true;
  const actions=[]; const errors=[];
  try {
    await fs.mkdir(DATA_DIR,{recursive:true}); await fs.mkdir(MEDIA_DIR,{recursive:true});
    actions.push('directories-ensured');
    // Repair malformed/partial JSON state by reloading safe defaults. Never delete
    // healthy data; only replace an invalid in-memory object with its persisted safe fallback.
    const checks=[
      ['queue',QUEUE_FILE,{version:1,items:[]}],
      ['store',STORE_FILE,{version:STORE_VERSION,siteId:SITE_ID,edgeId:EDGE_ID,tables:{},cursors:{},updatedAt:null}],
      ['identity',IDENTITY_FILE,{version:1,siteId:SITE_ID,edgeId:EDGE_ID,entries:{}}],
      ['devices',DEVICE_REGISTRY_FILE,{version:1,siteId:SITE_ID,edgeId:EDGE_ID,devices:{}}],
      ['conflicts',CONFLICTS_FILE,{version:1,siteId:SITE_ID,edgeId:EDGE_ID,items:{}}],
      ['mediaQueue',MEDIA_QUEUE_FILE,{version:1,siteId:SITE_ID,edgeId:EDGE_ID,items:[]}],
      ['mediaIndex',MEDIA_INDEX_FILE,{version:1,siteId:SITE_ID,edgeId:EDGE_ID,items:{}}]
    ];
    for (const [name,file,fallback] of checks) {
      try {
        const raw=await fs.readFile(file,'utf8'); const parsed=JSON.parse(raw);
        if (!parsed || typeof parsed!=='object') throw new Error('invalid-json');
      } catch (e) {
        if (e?.code==='ENOENT') continue;
        errors.push(`${name}:${e?.message||String(e)}`);
      }
    }
    // Remove stale completed queue entries using the same durable retention policy.
    const beforeQ=queue.length; const qCutoff=Date.now()-COMPLETED_QUEUE_TTL_MS;
    queue=queue.filter(x=>x.status!=='applied' || Date.parse(x.completedAt||x.updatedAt||x.createdAt||0)>=qCutoff);
    if(queue.length!==beforeQ){await persistQueue();actions.push(`queue-pruned:${beforeQ-queue.length}`);}
    const beforeM=mediaQueue.items.length; const mCutoff=Date.now()-MEDIA_COMPLETED_TTL_MS;
    mediaQueue.items=mediaQueue.items.filter(x=>x.status!=='applied' || Date.parse(x.completedAt||x.updatedAt||x.createdAt||0)>=mCutoff);
    if(mediaQueue.items.length!==beforeM){await persistMediaState();actions.push(`media-queue-pruned:${beforeM-mediaQueue.items.length}`);}
    const disk=await inspectDisk();
    if(disk.level==='critical') actions.push('disk-critical-no-aggressive-cleanup');
    if(CLOUD_BASE_URL && !flushRunning && (queue.some(x=>x.status==='pending') || mediaQueue.items.some(x=>x.status==='pending'))) {
      // Self-healing is deliberately limited to idempotent queues.
      await flushQueue(); await flushMediaQueue(); actions.push('pending-queues-flushed');
    }
    healthState.lastSelfHealAt=new Date().toISOString(); healthState.lastSelfHeal={reason,actions,errors,disk}; healthState.consecutiveErrors=errors.length?healthState.consecutiveErrors+1:0;
    await logEvent('self_heal',{reason,actions,errors:errors.slice(0,10),diskLevel:disk.level});
    return {success:true,reason,actions,errors,disk};
  } catch(e) {
    healthState.consecutiveErrors++; healthState.lastSelfHealAt=new Date().toISOString(); healthState.lastSelfHeal={reason,actions,errors:[e?.message||String(e)]};
    return {success:false,reason,actions,errors:[e?.message||String(e)]};
  } finally { selfHealRunning=false; }
}
async function getHealthDiagnostics() {
  const disk=await inspectDisk();
  const pending=queue.filter(x=>x.status==='pending').length, failed=queue.filter(x=>x.status==='failed').length;
  const mediaPending=mediaQueue.items.filter(x=>x.status==='pending').length, mediaFailed=mediaQueue.items.filter(x=>x.status==='failed').length;
  const openConflictCount=openConflicts().length;
  const files={queue:await inspectFile(QUEUE_FILE),store:await inspectFile(STORE_FILE),identity:await inspectFile(IDENTITY_FILE),devices:await inspectFile(DEVICE_REGISTRY_FILE),conflicts:await inspectFile(CONFLICTS_FILE),mediaQueue:await inspectFile(MEDIA_QUEUE_FILE),mediaIndex:await inspectFile(MEDIA_INDEX_FILE)};
  const issues=[];
  if(disk.level==='warning')issues.push('storage-warning'); if(disk.level==='critical')issues.push('storage-critical');
  if(failed||mediaFailed)issues.push('failed-queue-items'); if(openConflictCount)issues.push('open-conflicts');
  if(pending||mediaPending)issues.push('pending-queues'); if(healthState.consecutiveErrors)issues.push('recent-self-heal-errors');
  const level=issues.includes('storage-critical')?'critical':issues.length?'warning':'ok';
  healthState.lastCheckAt=new Date().toISOString();
  return {level,issues,disk,queues:{pending,failed,total:queue.length},media:{pending:mediaPending,failed:mediaFailed,total:mediaQueue.items.length},conflicts:{open:openConflictCount,total:Object.keys(conflictStore.items||{}).length},cloud:{configured:!!CLOUD_BASE_URL,reachable:cloudReachable},files,watchdog:{startedAt:new Date(healthState.startedAt).toISOString(),lastCheckAt:healthState.lastCheckAt,lastSelfHealAt:healthState.lastSelfHealAt,consecutiveErrors:healthState.consecutiveErrors}};
}

const requestHandler = async (req,res) => {
  const corsAllowed = cors(req,res);
  if (!corsAllowed) return json(res,{success:false,error:'Origine non autorisée par cet Edge.'},403);
  if (req.method === 'OPTIONS') return res.end();
  if (REQUIRE_HTTPS && !req.socket.encrypted) return json(res,{success:false,error:'HTTPS requis pour cet Edge.'},426);
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (u.pathname === '/edge/health' && req.method === 'GET') {
      const diagnostics=await getHealthDiagnostics();
      return json(res, { success:true, mode:'edge-first-v2', siteId:SITE_ID, edgeId:EDGE_ID, cloudConfigured:!!CLOUD_BASE_URL, cloudReachable, status:diagnostics.level, diagnostics, now:new Date().toISOString() });
    }
    if (u.pathname === '/edge/self-heal' && req.method === 'POST') {
      const identity=await getCachedIdentity(req.headers.authorization||'');
      if(!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if(!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const result=await runSelfHeal('admin');
      return json(res,{...result,diagnostics:await getHealthDiagnostics()});
    }
    if (u.pathname === '/edge/health/details' && req.method === 'GET') {
      const identity=await getCachedIdentity(req.headers.authorization||'');
      if(!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if(!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      return json(res,{success:true,diagnostics:await getHealthDiagnostics()});
    }
    if (u.pathname === '/.well-known/eduhaiti-edge' && req.method === 'GET') {
      return json(res, buildDiscoveryManifest(req, false));
    }
    if (u.pathname === '/edge/config' || u.pathname === '/edge/discovery') {
      return json(res, buildDiscoveryManifest(req, false));
    }
    if (u.pathname === '/edge/provision' && req.method === 'GET') {
      if (!PROVISIONING_ENABLED) return json(res,{success:false,error:'Provisionnement désactivé.'},404);
      return json(res, buildDiscoveryManifest(req, true));
    }
    if (u.pathname === '/edge/provision' && req.method === 'POST') {
      if (!PROVISIONING_ENABLED) return json(res,{success:false,error:'Provisionnement désactivé.'},404);
      if (!PROVISION_CODE) return json(res,{success:false,error:'Code de provisionnement non configuré sur cet Edge.'},503);
      const supplied = String(req.headers['x-eduhaiti-provision-code'] || '').trim();
      if (!supplied || supplied !== PROVISION_CODE) return json(res,{success:false,error:'Code de provisionnement invalide.'},401);
      const body = await readBody(req); let payload={};
      try { payload = body.length ? JSON.parse(body.toString('utf8')) : {}; } catch { return json(res,{success:false,error:'JSON invalide.'},400); }
      const requestedOrigin = String(payload.origin || '').trim();
      const manifest = buildDiscoveryManifest(req, true);
      if (requestedOrigin) manifest.allowedOrigin = requestedOrigin.slice(0,300);
      await logEvent('edge_provisioned',{origin:requestedOrigin||null});
      return json(res,{...manifest,provisioned:true,provisionedAt:new Date().toISOString()});
    }
    if (u.pathname === '/edge/local-api' && req.method === 'GET') {
      // Local business reads are a read-through cache only. IndexedDB on the
      // terminal remains the first offline source; this endpoint is the site
      // fallback when a terminal has no local snapshot of its own.
      const authorization = String(req.headers.authorization || '').trim();
      if (!authorization) return json(res, { success:false, error:'Authentification locale requise.' }, 401);
      const identity = await getCachedIdentity(authorization);
      if (!identity) return json(res, { success:false, error:'Session locale absente, expirée ou non renouvelée. Reconnectez-vous au Cloud/Edge avec Internet.' }, 401);
      const action = String(u.searchParams.get('action') || '').trim();
      const supported = new Set([
        'getStudents','getGrades','getPayments','getAttendance',
        'getStudentAttendance','getAttendanceForStudent',
        'getTimetableData','getStaffAssignments','getViewerInfo'
      ]);
      if (!supported.has(action)) return json(res, { success:false, error:`Lecture locale non disponible pour ${action}.` }, 400);
      const deviceCheck=await requireDevice(req,identity,null,!REQUIRE_REGISTERED_DEVICE);
      if (!deviceCheck.ok) return json(res,{success:false,error:deviceCheck.error||'Terminal non autorisé.',deviceId:deviceCheck.deviceId||''},403);
      if (action === 'getViewerInfo') return json(res, { success:true, ...identity, offline:true, edgeServed:true, stale:true, siteId:SITE_ID, edgeId:EDGE_ID, deviceId:deviceCheck.deviceId||'', generatedAt:new Date().toISOString(), identityCachedAt:new Date(identity.cachedAt).toISOString(), identityExpiresAt:new Date(identity.expiresAt).toISOString() });
      if (!permissionAllowed(identity, LOCAL_ACTION_PERMISSIONS[action])) return json(res, { success:false, error:`Permission insuffisante pour ${action}.`, permissionDenied:true }, 403);
      const table = ({
        getStudents:'students', getGrades:'grades', getPayments:'payments',
        getAttendance:'attendance', getStudentAttendance:'attendance',
        getAttendanceForStudent:'attendance', getTimetableData:'timetable',
        getStaffAssignments:'teacher_assignments'
      })[action];
      const limit = Math.min(Math.max(Number(u.searchParams.get('limit') || 1000), 1), 5000);
      const studentId = String(u.searchParams.get('studentId') || u.searchParams.get('id') || '').trim();
      const date = String(u.searchParams.get('date') || '').trim().slice(0,10);
      let rows = Object.values(store.tables[table] || {})
        .filter(r => r && !r.deleted && !r.deletedAt);
      if (studentId && ['attendance','grades','payments'].includes(table)) {
        rows = rows.filter(r => String(r.fields?.student_id || r.student_id || '') === studentId);
      }
      if (date && table === 'attendance') {
        rows = rows.filter(r => String(r.fields?.date || r.date || '').slice(0,10) === date);
      }
      rows.sort((a,b) => String(b.updatedAt || b.updated_at || '').localeCompare(String(a.updatedAt || a.updated_at || '')));
      rows = rows.slice(0, limit);
      const fieldsOf = r => ({ ...(r.fields || {}), id:r.id, version:r.version, updatedAt:r.updatedAt || r.updated_at, deletedAt:r.deletedAt || r.deleted_at || null });
      let data = rows.map(fieldsOf);
      if (action === 'getStudents') {
        data = data.map(r => ({
          StudentCode:r.student_code || r.StudentCode || r.id,
          StudentID:r.student_code || r.id, id:r.student_code || r.id,
          studentId:r.student_code || r.id,
          FirstName:r.first_name || r.FirstName || '', LastName:r.last_name || r.LastName || '',
          Phone:r.phone || r.Phone || '', Gender:r.gender || r.Gender || '',
          BirthDate:r.birth_date || r.BirthDate || '', Address:r.address || r.Address || '',
          PhotoURL:r.photo_url || r.PhotoURL || '',
          CustomFields:typeof r.custom_fields === 'string' ? (()=>{try{return JSON.parse(r.custom_fields||'{}')}catch{return {}}})() : (r.custom_fields || {}),
          CurrentLevel:r.current_level || '', Section:r.section || '',
          Active:r.active === 0 || r.active === '0' ? 'FALSE' : 'TRUE',
          CreatedAt:r.created_at || r.CreatedAt || null, UpdatedAt:r.updated_at || r.UpdatedAt || r.updatedAt || null
        }));
      }
      return json(res, { success:true, data, count:data.length, action, table, edgeServed:true, cloudReachable, stale:true, siteId:SITE_ID, edgeId:EDGE_ID, generatedAt:new Date().toISOString(), viewer:{userId:identity.userId,email:identity.email,role:identity.role,isTeacher:identity.isTeacher,isMaster:identity.isMaster,isGodMode:identity.isGodMode} });
    }

    if (u.pathname === '/edge/media/upload' && req.method === 'POST') {
      const authz=req.headers.authorization||''; const fp=await tokenFingerprint(authz); const identity=identityCache.entries[fp];
      if (!identity || !identity.active || Number(identity.expiresAt||0)<Date.now()) return json(res,{success:false,error:'Session Edge expirée ou non provisionnée.'},401);
      if (!mediaPermission(identity)) return json(res,{success:false,error:'Droits insuffisants pour gérer les médias.'},403);
      const deviceCheck=await requireDevice(req,identity,null,!REQUIRE_REGISTERED_DEVICE);
      if (!deviceCheck.ok) return json(res,{success:false,error:deviceCheck.error||'Terminal non autorisé.',deviceId:deviceCheck.deviceId||''},403);
      const body=await readBody(req); let parsed; try { parsed=JSON.parse(body.toString('utf8')); } catch { return json(res,{success:false,error:'JSON invalide.'},400); }
      try { const item=await enqueueMediaUpload(req,parsed,identity); if(CLOUD_BASE_URL) await pushMediaItem(item); const latest=mediaQueue.items.find(x=>x.id===item.id)||item; return json(res,{success:true,ok:true,edgeQueued:latest.status!=='applied',edgeServed:true,edgeMediaId:latest.id,fileKey:latest.fileKey,fileId:latest.cloudUpload?.fileId||'',url:latest.cloudUpload?.url||`/edge/media/file?key=${encodeURIComponent(latest.fileKey)}`,viewUrl:latest.cloudUpload?.viewUrl||`/edge/media/file?key=${encodeURIComponent(latest.fileKey)}`,size:latest.size,status:latest.status,siteId:SITE_ID,edgeId:EDGE_ID}); } catch(e) { return json(res,{success:false,error:e?.message||String(e)},400); }
    }
    if (u.pathname === '/edge/media' && req.method === 'GET') {
      const authz=req.headers.authorization||''; const identity=await getCachedIdentity(authz); if(!identity) return json(res,{success:false,error:'Session Edge expirée ou non provisionnée.'},401);
      const deviceCheck=await requireDevice(req,identity,null,!REQUIRE_REGISTERED_DEVICE);
      if (!deviceCheck.ok) return json(res,{success:false,error:deviceCheck.error||'Terminal non autorisé.',deviceId:deviceCheck.deviceId||''},403);
      if(!mediaPermission(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const items=Object.values(mediaIndex.items||{}).filter(x=>x); return json(res,{success:true,rows:items,edgeServed:true,siteId:SITE_ID,edgeId:EDGE_ID,cloudReachable});
    }
    if ((u.pathname === '/edge/media/file' || u.pathname.startsWith('/edge/media/')) && req.method === 'GET') {
      const key=u.pathname === '/edge/media/file' ? u.searchParams.get('key') : decodeURIComponent(u.pathname.slice('/edge/media/'.length));
      const safe=safeMediaKey(key); if(!safe) return json(res,{success:false,error:'Fichier média invalide.'},400);
      const authz=req.headers.authorization||''; const identity=await getCachedIdentity(authz); if(!identity || !mediaPermission(identity)) return json(res,{success:false,error:'Accès média refusé.'},403);
      const item=mediaIndex.items?.[safe]; if(!item) return json(res,{success:false,error:'Média introuvable.'},404);
      const pth=mediaFilePath(safe); try { const buf=await fs.readFile(pth); res.statusCode=200; res.setHeader('Content-Type',item.mimeType||'application/octet-stream'); res.setHeader('Cache-Control','private, max-age=3600'); return res.end(buf); } catch { return json(res,{success:false,error:'Fichier local non disponible.'},404); }
    }
    if (u.pathname === '/edge/media-status' && req.method === 'GET') {
      const identity=await getCachedIdentity(req.headers.authorization||''); if(!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      return json(res,{success:true,siteId:SITE_ID,edgeId:EDGE_ID,pending:mediaQueue.items.filter(x=>x.status==='pending').length,failed:mediaQueue.items.filter(x=>x.status==='failed').length,items:mediaQueue.items.map(x=>({id:x.id,fileKey:x.fileKey,name:x.name,size:x.size,status:x.status,attempts:x.attempts,lastError:x.lastError||null,cloudFileId:x.cloudUpload?.fileId||'',cloudUrl:x.cloudUpload?.url||'',createdAt:x.createdAt,updatedAt:x.updatedAt,deviceId:x.deviceId}))});
    }

    if (u.pathname === '/edge/conflicts' && req.method === 'GET') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,['p_settings','p_staff','pa_manage_users'])) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const items=Object.values(conflictStore.items||{}).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return json(res,{success:true,siteId:SITE_ID,edgeId:EDGE_ID,open:items.filter(x=>x.status==='open').length,total:items.length,items});
    }
    if (u.pathname === '/edge/conflicts/resolve' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,['p_settings','pa_manage_users'])) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const body=await readBody(req); let parsed; try{parsed=JSON.parse(body.toString('utf8'));}catch{return json(res,{success:false,error:'JSON invalide.'},400);}
      const conflictId=String(parsed?.conflictId||parsed?.id||'').trim(); const item=conflictStore.items[conflictId];
      if(!item) return json(res,{success:false,error:'Conflit introuvable.'},404);
      const resolution=String(parsed?.resolution||'').toLowerCase();
      if(!['cloud','local','manual'].includes(resolution)) return json(res,{success:false,error:'Résolution invalide. Utilisez cloud, local ou manual.'},400);
      if(resolution==='cloud') {
        item.status='resolved'; item.resolution='cloud'; item.resolvedAt=new Date().toISOString(); item.resolvedBy=identity.userId; item.updatedAt=item.resolvedAt;
        await persistConflictStore(); await logEvent('conflict_resolved',{conflictId, resolution:'cloud',byUserId:identity.userId});
        return json(res,{success:true,resolved:true,item});
      }
      const fields = resolution==='manual' ? (parsed?.fields && typeof parsed.fields==='object' ? parsed.fields : null) : item.localFields;
      if(!fields || typeof fields!=='object') return json(res,{success:false,error:'Champs de résolution manquants.'},400);
      const entry={idempotencyKey:`edge-conflict:${conflictId}:${Date.now()}`,table:item.table,op:item.operation||'upsert',id:item.rowId,baseVersion:Number(item.serverVersion||0),fields};
      if(item.operation==='delete') delete entry.fields;
      if(!CLOUD_BASE_URL) {
        return json(res,{success:false,error:'Cloud indisponible : la résolution est conservée mais ne peut pas être envoyée.'},503);
      }
      const reqData={path:'/api?action=syncPush',authorization:req.headers.authorization||'',body:{action:'syncPush',data:{entries:[entry],deviceId:'EDGE-CONFLICT'}}};
      const temp={id:`conflict-${conflictId}-${Date.now()}`,request:reqData,entryCount:1,deviceId:'EDGE-CONFLICT',status:'pending',attempts:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      queue.push(temp); await persistQueue(); await pushQueueItem(temp);
      const latest=queue.find(x=>x.id===temp.id)||temp;
      if(latest.status==='applied') {
        item.status='resolved'; item.resolution=resolution; item.resolvedAt=new Date().toISOString(); item.resolvedBy=identity.userId; item.updatedAt=item.resolvedAt; item.resolutionResult=latest.lastResult||null; await persistConflictStore();
        return json(res,{success:true,resolved:true,item,cloudResult:latest.lastResult||null});
      }
      return json(res,{success:false,error:latest.lastError||'La résolution n’a pas encore été appliquée à Cloud.',queued:true,conflict:item});
    }

    if (u.pathname === '/edge/audit' && req.method === 'GET') {
      const identity=await getCachedIdentity(req.headers.authorization||'');
      if(!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if(!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||100),1),500);
      const kind=String(u.searchParams.get('kind')||'').trim();
      const events=await readAuditEvents(limit,kind);
      return json(res,{success:true,siteId:SITE_ID,edgeId:EDGE_ID,events,count:events.length,limit,kind:kind||null,generatedAt:new Date().toISOString()});
    }

    if (u.pathname === '/edge/overview' && req.method === 'GET') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,['p_settings','p_staff','pa_manage_users'])) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const devices=Object.values(deviceRegistry.devices||{}).map(d=>({...d,status:deviceStatus(d)}));
      const syncPending=queue.filter(x=>x.status==='pending').length, syncFailed=queue.filter(x=>x.status==='failed').length;
      const mediaPending=mediaQueue.items.filter(x=>x.status==='pending').length, mediaFailed=mediaQueue.items.filter(x=>x.status==='failed').length;
      const online=devices.filter(d=>d.status==='online').length, offline=devices.filter(d=>d.status==='offline').length, revoked=devices.filter(d=>d.status==='revoked').length;
      const tables=Object.fromEntries(Object.entries(store.tables||{}).map(([t,rows])=>[t,Object.keys(rows||{}).length]));
      return json(res,{success:true,siteId:SITE_ID,edgeId:EDGE_ID,cloudReachable,generatedAt:new Date().toISOString(),devices:{total:devices.length,online,offline,revoked},sync:{pending:syncPending,failed:syncFailed,total:queue.length},media:{pending:mediaPending,failed:mediaFailed,total:mediaQueue.items.length},conflicts:{open:openConflicts().length,total:Object.keys(conflictStore.items||{}).length},store:{tables,updatedAt:store.updatedAt},identity:{userId:identity.userId,email:identity.email||'',role:identity.role||''}});
    }
    if (u.pathname === '/edge/sync/flush' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,['p_settings','pa_manage_users'])) return json(res,{success:false,error:'Droits insuffisants.'},403);
      await flushQueue(); await flushMediaQueue();
      return json(res,{success:true,cloudReachable,pendingSync:queue.filter(x=>x.status==='pending').length,failedSync:queue.filter(x=>x.status==='failed').length,pendingMedia:mediaQueue.items.filter(x=>x.status==='pending').length,failedMedia:mediaQueue.items.filter(x=>x.status==='failed').length,flushedAt:new Date().toISOString()});
    }

    if (u.pathname === '/edge/devices' && req.method === 'GET') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!permissionAllowed(identity,['p_settings','p_staff','pa_manage_users'])) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const rows=Object.values(deviceRegistry.devices||{}).map(d=>({...d,status:deviceStatus(d)}));
      return json(res,{success:true,siteId:SITE_ID,edgeId:EDGE_ID,ttlMs:DEVICE_OFFLINE_TTL_MS,devices:rows,count:rows.length});
    }
    if (u.pathname === '/edge/devices/register' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée ou non provisionnée.'},401);
      const body=await readBody(req); let parsed; try{parsed=JSON.parse(body.toString('utf8'));}catch{return json(res,{success:false,error:'JSON invalide.'},400);}
      const check=await requireDevice(req,identity,parsed,true);
      if(!check.ok) return json(res,{success:false,error:check.error||'Terminal non autorisé.'},403);
      const device=await registerDevice(req,parsed,identity,'online');
      return json(res,{success:true,registered:true,device:{...device,status:deviceStatus(device)}});
    }
    if (u.pathname === '/edge/devices/revoke' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,'pa_manage_users')) return json(res,{success:false,error:'Droits insuffisants pour révoquer un terminal.'},403);
      const body=await readBody(req); let parsed; try{parsed=JSON.parse(body.toString('utf8'));}catch{return json(res,{success:false,error:'JSON invalide.'},400);}
      const deviceId=String(parsed?.deviceId||parsed?.data?.deviceId||'').trim(); const d=getRegisteredDevice(deviceId);
      if(!d) return json(res,{success:false,error:'Terminal introuvable.'},404);
      d.revoked=true; d.revokedAt=new Date().toISOString(); d.status='revoked'; await persistDeviceRegistry();
      await logEvent('device_revoked',{deviceId,byUserId:identity.userId});
      return json(res,{success:true,device:{...d,status:'revoked'}});
    }
    if (u.pathname === '/edge/devices/unrevoke' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!identity.isMaster && !identity.isGodMode && !permissionAllowed(identity,'pa_manage_users')) return json(res,{success:false,error:'Droits insuffisants.'},403);
      const body=await readBody(req); let parsed; try{parsed=JSON.parse(body.toString('utf8'));}catch{return json(res,{success:false,error:'JSON invalide.'},400);}
      const deviceId=String(parsed?.deviceId||parsed?.data?.deviceId||'').trim(); const d=getRegisteredDevice(deviceId);
      if(!d) return json(res,{success:false,error:'Terminal introuvable.'},404);
      d.revoked=false; d.revokedAt=null; d.status='offline'; await persistDeviceRegistry();
      await logEvent('device_unrevoked',{deviceId,byUserId:identity.userId});
      return json(res,{success:true,device:{...d,status:deviceStatus(d)}});
    }


    if (u.pathname === '/edge/media-backup/export' && req.method === 'GET') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants pour exporter les médias Edge.'},403);
      try {
        const result=await buildMediaBackupArchive();
        await logEvent('media_backup_exported',{byUserId:identity.userId,bytes:result.bytes,files:result.manifest.media.length});
        res.statusCode=200; res.setHeader('Content-Type','application/gzip'); res.setHeader('Content-Disposition',`attachment; filename="eduhaiti-media-${SITE_ID}-${new Date().toISOString().replace(/[:.]/g,'-')}.tar.gz"`); return res.end(result.archive);
      } catch(e) { return json(res,{success:false,error:e?.message||String(e)},400); }
    }
    if (u.pathname === '/edge/media-backup/inspect' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      try { const body=await readBody(req, MEDIA_BACKUP_MAX_BYTES); const {manifest}=await inspectMediaBackupArchive(body); return json(res,{success:true,requiresConfirmation:true,siteId:SITE_ID,createdAt:manifest.createdAt,files:manifest.media.length,totalBytes:manifest.media.reduce((a,x)=>a+Number(x.size||0),0)}); } catch(e) { return json(res,{success:false,error:e?.message||String(e)},400); }
    }
    if (u.pathname === '/edge/media-backup/restore' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants.'},403);
      if (u.searchParams.get('confirm') !== 'true') return json(res,{success:false,requiresConfirmation:true,error:'Restauration média bloquée : confirmation explicite requise.'},409);
      try { const body=await readBody(req, MEDIA_BACKUP_MAX_BYTES); const result=await restoreMediaBackupArchive(body); await logEvent('media_backup_restored',{byUserId:identity.userId,restored:result.restored,skipped:result.skipped}); return json(res,{success:true,...result,restoredAt:new Date().toISOString()}); } catch(e) { return json(res,{success:false,error:e?.message||String(e)},400); }
    }

    if (u.pathname === '/edge/backup/export' && req.method === 'GET') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants pour exporter la sauvegarde Edge.'},403);
      const snapshot = backupSnapshot();
      await logEvent('backup_exported',{byUserId:identity.userId});
      res.statusCode=200; res.setHeader('Content-Type','application/json; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="eduhaiti-edge-${SITE_ID}-${new Date().toISOString().replace(/[:.]/g,'-')}.json"`);
      return res.end(JSON.stringify(snapshot,null,2));
    }
    if (u.pathname === '/edge/backup/restore' && req.method === 'POST') {
      const identity = await getCachedIdentity(req.headers.authorization || '');
      if (!identity) return json(res,{success:false,error:'Session Edge expirée.'},401);
      if (!adminIdentity(identity)) return json(res,{success:false,error:'Droits insuffisants pour restaurer la sauvegarde Edge.'},403);
      const body=await readBody(req); let parsed; try { parsed=JSON.parse(body.toString('utf8')); } catch { return json(res,{success:false,error:'JSON de sauvegarde invalide.'},400); }
      const validation=validateBackup(parsed); if(validation) return json(res,{success:false,error:validation},400);
      if (parsed.confirm !== true) return json(res,{success:false,requiresConfirmation:true,error:'Restauration bloquée : confirmation explicite requise.',preview:{siteId:parsed.siteId,createdAt:parsed.createdAt,queue:Array.isArray(parsed.queue)?parsed.queue.length:0,mediaPending:Number(parsed.mediaQueue?.items?.filter?.(x=>x?.status==='pending')?.length||0),conflicts:Number(Object.keys(parsed.conflictStore?.items||{}).length)}} ,409);
      await restoreSnapshot(parsed);
      await logEvent('backup_restored',{byUserId:identity.userId,backupCreatedAt:parsed.createdAt||null});
      return json(res,{success:true,restored:true,siteId:SITE_ID,edgeId:EDGE_ID,restoredAt:new Date().toISOString(),warning:'Les fichiers média binaires du dossier media/ ne sont pas restaurés par cet import JSON.'});
    }

    if (u.pathname === '/edge/data-status' && req.method === 'GET') {
      const tables = Object.fromEntries(Object.entries(store.tables).map(([t, rows]) => [t, Object.keys(rows || {}).length]));
      return json(res, { success:true, siteId:SITE_ID, edgeId:EDGE_ID, tables, cursors:store.cursors, updatedAt:store.updatedAt, storeFile:STORE_FILE });
    }

    const localSyncPath = u.pathname.startsWith('/api') || u.pathname === '/';
    if (localSyncPath && u.searchParams.get('action') === 'syncPull' && req.method === 'GET') {
      const table = u.searchParams.get('table');
      const cursor = u.searchParams.get('cursor') || '';
      const limit = Number(u.searchParams.get('limit') || 500);
      if (!table) return json(res, { success:false, error:'table manquante.' }, 400);
      // Refresh the local site store from Cloud whenever possible. If Cloud is
      // unreachable, serve the most recent local snapshot instead.
      let cloudError = null;
      if (CLOUD_BASE_URL) {
        try {
          const target = cloudTarget(req.url);
          const r = await fetch(target, { method:'GET', headers:forwardedHeaders(req), signal:AbortSignal.timeout(12000) });
          const text = await r.text();
          let body; try { body = JSON.parse(text); } catch { body = null; }
          if (r.ok && body?.success !== false) {
            cloudReachable = true;
            storeApplyRows(table, Array.isArray(body?.rows) ? body.rows : [], body?.cursor || cursor);
            await persistStore();
            return json(res, { ...body, edgeServed:false, edgeStoreRefreshed:true, siteId:SITE_ID, edgeId:EDGE_ID });
          }
          cloudError = body?.error || `HTTP ${r.status}`;
        } catch (e) { cloudReachable = false; cloudError = e?.message || String(e); }
      }
      const local = localDelta(table, cursor, limit);
      if (local.rows.length || Object.keys(store.tables[table] || {}).length) {
        return json(res, { success:true, ...local, edgeServed:true, cloudReachable:false, siteId:SITE_ID, edgeId:EDGE_ID, stale:true, cloudError });
      }
      return json(res, { success:false, error:cloudError || 'Aucune donnée locale disponible sur cet Edge.', edgeServed:true, siteId:SITE_ID, edgeId:EDGE_ID }, 503);
    }

    if (u.pathname === '/edge/queue' && req.method === 'GET') {
      return json(res, { success:true, siteId:SITE_ID, edgeId:EDGE_ID, pending:queue.filter(x=>x.status==='pending').length, failed:queue.filter(x=>x.status==='failed').length, items:queue.map(x=>({ id:x.id, deviceId:x.deviceId, entryCount:x.entryCount, status:x.status, attempts:x.attempts, createdAt:x.createdAt, updatedAt:x.updatedAt, lastError:x.lastError||null })) });
    }
    if (u.pathname === '/edge/sync-status' && req.method === 'GET') {
      const deviceId = u.searchParams.get('deviceId');
      const items = queue.filter(x => !deviceId || x.deviceId === deviceId).map(x => ({ id:x.id, deviceId:x.deviceId, entryCount:x.entryCount, status:x.status, attempts:x.attempts, createdAt:x.createdAt, updatedAt:x.updatedAt, lastError:x.lastError||null, lastResult:x.lastResult||null }));
      return json(res, { success:true, items });
    }

    const bodyBuf = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') ? await readBody(req) : null;
    let parsedBody = null;
    if (bodyBuf?.length) { try { parsedBody = JSON.parse(bodyBuf.toString('utf8')); } catch (_) {} }

    if (localSyncPath) {
      if (isSyncPush(req, parsedBody)) {
        const entries = Array.isArray(parsedBody?.data?.entries) ? parsedBody.data.entries : [];
        try {
          const queued = await enqueueSyncPush(req, parsedBody);
          // A previously completed idempotency key is replayed from the
          // durable Edge result. This lets a terminal clear its IndexedDB
          // outbox even if Cloud became available after the terminal left.
          if (queued.completed && queued.existing?.lastResult) {
            return json(res, { ...queued.existing.lastResult, edgeReplayed:true, edgeQueueId:queued.queueId, siteId:SITE_ID, edgeId:EDGE_ID });
          }
          // Try immediately. If Cloud is available, this normally becomes a
          // normal synchronous response. If not, the durable queue accepts it.
          if (CLOUD_BASE_URL) {
            const item = queue.find(x => x.id === queued.queueId);
            if (item) await pushQueueItem(item);
            const latest = queue.find(x => x.id === queued.queueId);
            if (latest?.status === 'applied' && latest.lastResult) {
              return json(res, { ...latest.lastResult, edgeReplayed:false, edgeQueueId:latest.id, siteId:SITE_ID, edgeId:EDGE_ID });
            }
          }
          return json(res, { success:true, edgeQueued:true, siteId:SITE_ID, edgeId:EDGE_ID, outcomes:queuedOutcomes(entries, queued.queueId), conflicts:0, duplicates:0 });
        } catch (e) {
          return json(res, { success:false, error:e?.message || String(e) }, 400);
        }
      }
      await logEvent('proxy', { method:req.method, path:u.pathname, action:u.searchParams.get('action') || parsedBody?.action || null });
      return proxy(req,res,bodyBuf);
    }
    return json(res,{success:false,error:'Route Edge inconnue.'},404);
  } catch (e) {
    await logEvent('error',{error:e?.message || String(e)});
    return json(res,{success:false,error:e?.message || String(e)},500);
  }
};

setInterval(() => { runSelfHeal('watchdog').catch(e => { healthState.consecutiveErrors++; }); }, HEALTH_WATCHDOG_MS).unref?.();
runSelfHeal('startup').catch(() => {});

let server;
if (TLS_CERT_FILE && TLS_KEY_FILE) {
  try {
    const [cert,key] = await Promise.all([fs.readFile(TLS_CERT_FILE), fs.readFile(TLS_KEY_FILE)]);
    server = https.createServer({cert,key}, requestHandler);
  } catch (e) {
    if (REQUIRE_HTTPS) throw new Error(`TLS requis mais certificat/clé introuvable : ${e?.message || e}`);
    console.warn(`TLS non activé : ${e?.message || e}`);
    server = http.createServer(requestHandler);
  }
} else {
  if (REQUIRE_HTTPS) throw new Error('EDU_EDGE_REQUIRE_HTTPS=true mais certificat et clé TLS manquants.');
  server = http.createServer(requestHandler);
}
const protocol = TLS_CERT_FILE && TLS_KEY_FILE ? 'https' : 'http';
server.listen(PORT, HOST, () => {
  console.log(`EduHaïti Edge v2 ${EDGE_ID} — site ${SITE_ID} — ${protocol}://${HOST}:${PORT}`);
  console.log(`Queue locale : ${QUEUE_FILE}`);
  if (!CLOUD_BASE_URL) console.warn('EDU_EDGE_CLOUD_URL n\'est pas configurée : les syncPush seront conservés localement.');
});
