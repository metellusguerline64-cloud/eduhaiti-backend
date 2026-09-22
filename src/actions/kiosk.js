// 0066 — Port of Code.gs saveKioskWatchCodes_ / getKioskWatchCodes_.
// The legacy Sheet `Settings` key KIOSK_WATCH_CODES is represented by the
// existing D1 `settings` key/value table. One Worker database is one school,
// so the settings row is naturally tenant-isolated; no Drive/Sheet dependency.
import { loadViewer } from "../lib/accessScope.js";

function parseCodes(value) {
  if (Array.isArray(value)) return value;
  try { const x = JSON.parse(String(value || "[]")); return Array.isArray(x) ? x : []; }
  catch { return []; }
}
function canManageKiosk(viewer) {
  return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_attendance));
}

export async function saveKioskWatchCodes(data, auth, env) {
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success:false, error:"Session invalide." };
    if (!canManageKiosk(viewer)) return { success:false, error:"Permission insuffisante." };
    const codes = Array.isArray(data?.codes) ? data.codes : [];
    const value = JSON.stringify(codes);
    const ts = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .bind("KIOSK_WATCH_CODES", value, ts).run();
    return { success:true, message:`${codes.length} code(s) de surveillance sauvegardés.` };
  } catch (e) { return { success:false, error:e.message }; }
}

export async function getKioskWatchCodes(_data, auth, env) {
  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success:false, error:"Session invalide.", codes:[] };
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key=? LIMIT 1`).bind("KIOSK_WATCH_CODES").first();
    return { success:true, codes:parseCodes(row?.value) };
  } catch (e) { return { success:false, error:e.message, codes:[] }; }
}
