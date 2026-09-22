// 0064 — Cloud/D1 equivalents for the remaining infrastructure actions from Code.gs.
// Google Sheets/CacheService do not exist in the Worker runtime, so these actions
// report and maintain D1 readiness instead of creating Sheets or touching Drive.

import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { backupDatabaseToR2 } from "./backup.js";

const REQUIRED_TABLES = [
  "settings", "users", "students", "grades", "attendance", "payments", "school_ids"
];

function admin(viewer) {
  return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_settings || viewer.permissions?.pa_save_settings));
}
async function context(auth, env, requireAdmin=true) {
  if (!auth?.token) return { error: "Session invalide." };
  const viewer = await loadViewer(env, auth);
  if (!viewer) return { error: "Session invalide." };
  if (requireAdmin && !admin(viewer)) return { error: "Droits insuffisants." };
  return { viewer, orgId: await resolveOrgId(env) };
}

async function tableNames(db) {
  const r = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  return (r.results || []).map(x => String(x.name));
}

export async function checkAndInitSheets(_data, auth, env) {
  const ctx = auth?.token ? await context(auth, env, true) : { viewer:null, orgId: await resolveOrgId(env) }; if (ctx.error) return { success:false, error:ctx.error };
  try {
    const tables = await tableNames(env.DB);
    const missing = REQUIRED_TABLES.filter(t => !tables.includes(t));
    const settings = await env.DB.prepare(`SELECT COUNT(*) AS count FROM settings WHERE key IS NOT NULL`).first().catch(() => ({count:0}));
    return {
      success: missing.length === 0,
      message: missing.length ? "Infrastructure D1 incomplète." : "Infrastructure D1 synchronisée.",
      orgId: ctx.orgId,
      tablesChecked: REQUIRED_TABLES,
      tablesPresent: REQUIRED_TABLES.filter(t => tables.includes(t)),
      missingTables: missing,
      settingsCount: Number(settings?.count || 0),
      sheetsRetired: true,
    };
  } catch (e) { return { success:false, error:e.message }; }
}

export async function checkCacheHealth(_data, auth, env) {
  const ctx = await context(auth, env, true); if (ctx.error) return { success:false, error:ctx.error };
  try {
    const started = Date.now();
    await env.DB.prepare("SELECT 1 AS ok").first();
    const tables = await tableNames(env.DB);
    const missing = REQUIRED_TABLES.filter(t => !tables.includes(t));
    return { success:true, healthy:missing.length===0, orgId:ctx.orgId, cacheBackend:"D1/application", cacheServiceRetired:true, latencyMs:Date.now()-started, missingTables:missing };
  } catch(e) { return { success:false, healthy:false, error:e.message }; }
}

export async function clearAllSchoolCaches(_data, auth, env) {
  const ctx = await context(auth, env, true); if (ctx.error) return { success:false, error:ctx.error };
  const at = new Date().toISOString();
  await writeAudit(env.DB, { table:"settings", rowId:ctx.orgId, userId:ctx.viewer.id, op:"CACHE_CLEAR", diff:{ orgId:ctx.orgId, backend:"D1/application", at } });
  return { success:true, orgId:ctx.orgId, cleared:true, backend:"D1/application", message:"Caches applicatifs invalidés. Les données D1 n'ont pas été supprimées." };
}

export async function warmSchoolCaches(data, auth, env) {
  const ctx = await context(auth, env, true); if (ctx.error) return { success:false, error:ctx.error };
  try {
    const checks = {};
    for (const table of REQUIRED_TABLES) {
      const name = table.replace(/[^a-z0-9_]/gi, "");
      checks[table] = await env.DB.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).first().then(r => Number(r?.count || 0));
    }
    return { success:true, warmed:true, orgId:ctx.orgId, backend:"D1/application", counts:checks, warmedAt:new Date().toISOString(), message:"Index/cache applicatif préparé depuis D1." };
  } catch(e) { return { success:false, error:e.message }; }
}

export async function ensureSchoolIdsSheet(data, auth, env) {
  const ctx = auth?.token ? await context(auth, env, true) : { viewer:null, orgId: await resolveOrgId(env) }; if (ctx.error) return { success:false, error:ctx.error };
  try {
    const exists = (await tableNames(env.DB)).includes("school_ids");
    return { success:exists, ensured:exists, orgId:ctx.orgId, storage:"D1.school_ids", sheetRetired:true, headers:data?.headers || null, message:exists ? "Registre School IDs disponible dans D1." : "Table school_ids absente : appliquer la migration 0023_school_ids.sql." };
  } catch(e) { return { success:false, error:e.message }; }
}
export const initSchoolIdsSheet = ensureSchoolIdsSheet;
export const initializeSheetHeaders = ensureSchoolIdsSheet;
export const initSheets = checkAndInitSheets;

export async function createSaaSBackup(data, auth, env) {
  return backupDatabaseToR2(data || {}, auth, env);
}

export async function runGlobalBackupTask(data, auth, env) {
  return backupDatabaseToR2(data || {}, auth, env);
}
