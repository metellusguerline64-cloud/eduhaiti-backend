// Shared audit-log writer. Keeps both successful writes and permission/security
// events in the same D1 audit stream so the audit dashboard can reproduce the
// Code.gs Action/Actor/Permission/Status contract.

export async function writeAudit(db, { table, rowId, userId, deviceId, op, diff, permission, status } = {}) {
  await db.prepare(
    `INSERT INTO audit_log (id, table_name, row_id, user_id, device_id, op, diff, created_at, permission, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    table || 'SYSTEM',
    rowId || 'SYSTEM',
    userId || null,
    deviceId || null,
    op || 'unknown',
    diff ? JSON.stringify(diff) : null,
    new Date().toISOString(),
    permission || null,
    status || 'REUSSITE'
  ).run();
}
