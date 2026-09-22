// EduHaïti — logical D1 -> R2 backups.
//
// Cloudflare Workers cannot run `wrangler d1 export` from inside the Worker.
// This module therefore creates a portable logical snapshot: SQLite schema
// definitions + every user table's rows, compressed as gzip, then stores it in
// R2. It is intentionally infrastructure-level: no backup UI is required.

import { resolveOrgId } from "../lib/org.js";
import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

function canBackup(viewer) {
  return !!(viewer && (viewer.isMaster || viewer.isGodMode || viewer.permissions?.p_settings || viewer.permissions?.pa_save_settings));
}

function safeKeyPart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

async function gzipJson(value) {
  const source = JSON.stringify(value);
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function buildSnapshot(db, orgId) {
  const tablesResult = await db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  const tables = [];
  for (const meta of (tablesResult.results || [])) {
    const name = String(meta.name || "").trim();
    if (!name) continue;
    const rowsResult = await db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).all();
    tables.push({
      name,
      sql: meta.sql || null,
      rowCount: (rowsResult.results || []).length,
      rows: rowsResult.results || [],
    });
  }

  return {
    format: "eduhaiti-d1-logical-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    orgId,
    tableCount: tables.length,
    tables,
  };
}

export async function backupDatabaseToR2(data = {}, auth, env) {
  if (!auth?.token) return { success:false, error:"Session invalide." };
  if (!env.BACKUP_BUCKET) return { success:false, error:"R2 non configuré : ajoutez le binding BACKUP_BUCKET avant d'activer les sauvegardes." };

  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success:false, error:"Session invalide." };
    if (!canBackup(viewer)) return { success:false, error:"Droits insuffisants." };

    const orgId = await resolveOrgId(env);
    const snapshot = await buildSnapshot(env.DB, orgId);
    const compressed = await gzipJson(snapshot);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `backups/${safeKeyPart(orgId)}/${stamp}.json.gz`;

    await env.BACKUP_BUCKET.put(key, compressed, {
      httpMetadata: { contentType:"application/gzip", contentEncoding:"gzip" },
      customMetadata: {
        orgId: String(orgId),
        format: "eduhaiti-d1-logical-backup",
        version: "1",
        tableCount: String(snapshot.tableCount),
      },
    });

    await writeAudit(env.DB, {
      table:"settings",
      rowId:key,
      userId:viewer.id,
      op:"D1_BACKUP_R2",
      diff:{ orgId, tableCount:snapshot.tableCount, sizeBytes:compressed.byteLength, key },
    });

    return {
      success:true,
      orgId,
      key,
      tableCount:snapshot.tableCount,
      sizeBytes:compressed.byteLength,
      createdAt:snapshot.createdAt,
      message:"Sauvegarde D1 terminée et stockée dans R2.",
    };
  } catch (e) {
    return { success:false, error:e.message };
  }
}

// Cron-only variant. It deliberately does not require a user session.
// The scheduled event is trusted by Cloudflare and the tenant is supplied by
// the caller (src/index.js), so there is no public endpoint for this path.
export async function runDatabaseBackup(tenantEnv) {
  if (!tenantEnv?.BACKUP_BUCKET) throw new Error("R2 BACKUP_BUCKET non configuré.");
  const orgId = await resolveOrgId(tenantEnv);
  const snapshot = await buildSnapshot(tenantEnv.DB, orgId);
  const compressed = await gzipJson(snapshot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `backups/${safeKeyPart(orgId)}/${stamp}.json.gz`;

  await tenantEnv.BACKUP_BUCKET.put(key, compressed, {
    httpMetadata: { contentType:"application/gzip", contentEncoding:"gzip" },
    customMetadata: { orgId:String(orgId), format:"eduhaiti-d1-logical-backup", version:"1", tableCount:String(snapshot.tableCount) },
  });

  return { success:true, orgId, key, tableCount:snapshot.tableCount, sizeBytes:compressed.byteLength, createdAt:snapshot.createdAt };
}


// Legacy compatibility for Code.gs `grantBackupServiceAccess`.
// In the Cloudflare architecture there is no Google Drive file to share.
// Backup access is controlled by the private R2 binding instead. We retain
// the action name so old clients do not break, but never grant Drive access
// or store credentials/secrets in D1.
export async function grantBackupServiceAccess(data = {}, auth, env) {
  if (!auth?.token) return { success:false, error:"Session invalide." };
  const viewer = await loadViewer(env, auth);
  if (!viewer) return { success:false, error:"Session invalide." };
  if (!canBackup(viewer)) return { success:false, error:"Droits insuffisants." };
  if (!env.BACKUP_BUCKET) {
    return { success:false, error:"R2 BACKUP_BUCKET non configuré." };
  }
  const requested = String(data?.serviceEmail || data?.email || "").trim().toLowerCase();
  // The historical parameter is accepted only for compatibility. The Worker
  // does not use this address for authorization and does not persist it.
  return {
    success:true,
    alreadyShared:true,
    serviceEmail: requested || null,
    accessMode:"R2_PRIVATE_BINDING",
    message:"Dans EduHaïti Cloud, l’accès aux sauvegardes est contrôlé par le binding R2 privé; aucun partage Google Drive n’est nécessaire."
  };
}
