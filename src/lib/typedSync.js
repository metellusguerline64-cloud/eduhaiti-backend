// Typed outbox/delta sync for promoted Phase-1/2 tables.
// Keeps the client outbox contract stable while mapping `fields` to real D1 columns.

import { writeAudit } from './audit.js';

const DEFINITIONS = {
  students: {
    strict: false,
    columns: ['student_code','last_name','first_name','phone','gender','birth_date','address','photo_url','current_level','section','enrollment_status','active','generated_source','generated_org_id','custom_fields','pin_hash'],
    idColumn: 'id'
  },
  grades: {
    strict: true,
    columns: ['history_id','student_id','grade_level_id','subject_id','period_id','score','mention','teacher_id','scores_json'],
    idColumn: 'id'
  },
  attendance: {
    strict: true,
    columns: ['history_id','student_id','grade_level_id','date','status','recorded_by','meta_json'],
    idColumn: 'id'
  },
  payments: {
    strict: true,
    columns: ['history_id','student_id','student_name','description','amount','cashier_email','status','notes','payment_date','reference','client_request_id'],
    idColumn: 'id'
  },
  teacher_assignments: {
    strict: false,
    columns: ['teacher_name','teacher_id','class_name','class_id','subject','day','start_time','end_time','hours','rate','salary','payment_mode','has_conflict','active','meta_json'],
    idColumn: 'id'
  },
  timetable: {
    strict: false,
    columns: ['class_name','day_index','day_label','start_time','end_time','subject','teacher','teacher_id','conflict','active','meta_json'],
    idColumn: 'id'
  }
};

export const TYPED_SYNC_TABLES = new Set(Object.keys(DEFINITIONS));

const META = new Set(['id','org_id','version','created_at','updated_at','deleted_at']);

function nowIso() { return new Date().toISOString(); }
function definition(table) {
  const d = DEFINITIONS[table];
  if (!d) throw new Error(`Table de synchronisation inconnue : ${table}`);
  return d;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function rowToFields(table, row) {
  const d = definition(table);
  const fields = {};
  for (const c of d.columns) {
    let v = row[c];
    if (c.endsWith('_json') || c === 'custom_fields' || c === 'scores_json') v = parseMaybeJson(v);
    fields[c] = v;
  }
  return fields;
}

export async function typedDeltaPull(db, table, orgId, cursor, limit = 500) {
  definition(table);
  const rawCursor = String(cursor || '1970-01-01T00:00:00.000Z');
  const sep = rawCursor.lastIndexOf('|');
  const since = sep > 0 ? rawCursor.slice(0, sep) : rawCursor;
  const sinceId = sep > 0 ? rawCursor.slice(sep + 1) : '';
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const { results = [] } = await db.prepare(
    `SELECT * FROM ${table} WHERE org_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at ASC, id ASC LIMIT ?`
  ).bind(orgId, since, since, sinceId, capped).all();
  const rows = results.map(r => ({
    id: r.id,
    version: Number(r.version || 1),
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    deleted: !!r.deleted_at,
    fields: rowToFields(table, r)
  }));
  return {
    table,
    rows,
    cursor: rows.length ? `${rows[rows.length - 1].updatedAt}|${rows[rows.length - 1].id}` : rawCursor,
    hasMore: rows.length === capped
  };
}

function normalizeValue(column, value) {
  if (column.endsWith('_json') || column === 'custom_fields' || column === 'scores_json') {
    if (typeof value === 'string') return value;
    return JSON.stringify(value ?? (column === 'scores_json' || column === 'custom_fields' || column === 'meta_json' ? {} : null));
  }
  if (column === 'active' || column === 'has_conflict' || column === 'conflict') {
    return value === true || value === 1 || value === '1' ? 1 : 0;
  }
  return value === undefined ? null : value;
}

export async function applyTypedOutboxBatch(db, entries, { orgId, userId, deviceId } = {}) {
  const outcomes = [];
  for (const entry of entries || []) {
    try { outcomes.push(await applyTypedOne(db, entry, { orgId, userId, deviceId })); }
    catch (err) {
      outcomes.push({ idempotencyKey: entry?.idempotencyKey, status: 'error', error: err?.message || String(err) });
    }
  }
  return outcomes;
}

async function applyTypedOne(db, entry, { orgId, userId, deviceId }) {
  const { idempotencyKey, table, op, id } = entry || {};
  const d = definition(table);
  if (!idempotencyKey) throw new Error('idempotencyKey manquant.');
  if (!id) throw new Error('id manquant.');
  if (op !== 'upsert' && op !== 'delete') throw new Error(`op inconnue : ${op}`);
  if (!orgId) throw new Error('ORG_ID manquant.');

  const already = await db.prepare('SELECT 1 FROM sync_applied_ops WHERE idempotency_key = ?').bind(idempotencyKey).first();
  if (already) return { idempotencyKey, status: 'already_applied', id, table };

  const existing = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`).bind(id, orgId).first();

  // Attendance is a special offline-collaboration case. Different devices
  // intentionally generate different row IDs, so the row ID alone cannot
  // prevent two teachers from recording the same student on the same day.
  // Resolve the business key here, at the server, after all devices reconnect.
  // Same status => harmless duplicate and the pending operation can be retired.
  // Different status => real business conflict and must remain visible.
  if (table === 'attendance' && op === 'upsert') {
    const f = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
    const studentId = String(f.student_id || '').trim();
    const date = String(f.date || '').slice(0, 10);
    if (studentId && date) {
      const businessExisting = await db.prepare(
        `SELECT * FROM attendance WHERE org_id=? AND student_id=? AND date=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`
      ).bind(orgId, studentId, date).first();
      if (businessExisting && String(businessExisting.id) !== String(id)) {
        const sameStatus = String(businessExisting.status || '').toUpperCase() === String(f.status || '').toUpperCase();
        if (sameStatus) {
          await db.prepare('INSERT INTO sync_applied_ops (idempotency_key, table_name, row_id) VALUES (?, ?, ?)')
            .bind(idempotencyKey, table, id).run();
          await writeAudit(db, { table, rowId: businessExisting.id, userId, deviceId, op: 'duplicate_collapsed', diff: {
            duplicateRowId: id, studentId, date, status: f.status || null, deviceId: deviceId || null
          }});
          return { idempotencyKey, status: 'duplicate', id, table, canonicalId: businessExisting.id, serverVersion: businessExisting.version, serverUpdatedAt: businessExisting.updated_at };
        }
        return { idempotencyKey, status: 'conflict', id, table, businessKey: `${studentId}|${date}`, canonicalId: businessExisting.id, serverVersion: businessExisting.version, serverUpdatedAt: businessExisting.updated_at, serverStatus: businessExisting.status, serverRow: businessExisting };
      }
    }
  }

  if (existing && d.strict && Number(entry.baseVersion || 0) !== Number(existing.version)) {
    return { idempotencyKey, status: 'conflict', id, table, serverVersion: existing.version, serverUpdatedAt: existing.updated_at, serverRow: existing };
  }

  const ts = nowIso();
  const nextVersion = existing ? Number(existing.version) + 1 : 1;

  if (op === 'delete') {
    if (existing) {
      await db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ? AND org_id = ?`)
        .bind(ts, ts, nextVersion, id, orgId).run();
    } else {
      // Tombstone only works for tables whose required business columns have
      // defaults; for the promoted tables, a delete of an unknown row is rejected
      // rather than creating an invalid partial record.
      return { idempotencyKey, status: 'rejected', id, table, error: 'Suppression impossible : ligne serveur inconnue.' };
    }
  } else {
    const fields = entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
    const defaults = {
      students: { section: 'A', enrollment_status: 'ACTIVE', active: 1, custom_fields: {}, pin_hash: null },
      grades: { scores_json: {} },
      attendance: { status: 'PRESENT', recorded_by: userId || 'SYNC', meta_json: {} },
      payments: { amount: 0, status: 'PAID' },
      teacher_assignments: { teacher_name: '', class_name: '', hours: 0, rate: 0, salary: 0, payment_mode: '', has_conflict: 0, active: 1, meta_json: {} },
      timetable: { day_index: 0, conflict: 0, active: 1, meta_json: {} }
    }[table] || {};
    const cols = ['id','org_id', ...d.columns, 'version','updated_at','deleted_at'];
    const vals = [id, orgId, ...d.columns.map(c => {
      const supplied = Object.prototype.hasOwnProperty.call(fields, c) ? fields[c] : undefined;
      const fallback = existing && Object.prototype.hasOwnProperty.call(existing, c) ? existing[c] : defaults[c];
      return normalizeValue(c, supplied === undefined ? fallback : supplied);
    }), nextVersion, ts, null];
    const placeholders = cols.map(() => '?').join(',');
    const updates = [...d.columns.map(c => `${c}=excluded.${c}`), 'version=excluded.version', 'updated_at=excluded.updated_at', 'deleted_at=NULL'];
    await db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates.join(',')}`)
      .bind(...vals).run();
  }

  await db.prepare('INSERT INTO sync_applied_ops (idempotency_key, table_name, row_id) VALUES (?, ?, ?)')
    .bind(idempotencyKey, table, id).run();
  await writeAudit(db, { table, rowId: id, userId, deviceId, op, diff: op === 'upsert' ? entry.fields || {} : null });

  return { idempotencyKey, status: 'applied', id, table, version: nextVersion, updatedAt: ts };
}
