// Generic sync engine — Section 4 of the migration blueprint.
//
// Every syncable table follows the same convention (id / version /
// updated_at / deleted_at), so one implementation of "delta pull" and
// "batch push" works across all of them instead of one per domain.
// Domain-specific fields live in the `fields` JSON column until real
// Code.gs columns replace it (see schema.sql).

import { writeAudit } from "./audit.js";

// Tables allowed through the generic sync endpoints. Keep this in sync
// with schema.sql. Anything not listed here is rejected instead of
// silently doing nothing.
//
// NOTE: 'students' is intentionally NOT in this set. It was promoted to
// a real typed table once Code.gs's actual student schema was available
// (see schema.sql + src/lib/generatedIdsSync.js) — the generic `fields`
// JSON blob approach only applies to tables that haven't been promoted
// yet. Client-side offline edits to students need a dedicated push path
// once Phase 1 ports real student CRUD actions; that's not built yet.
//
// 'grades' and 'attendance' are ALSO no longer in this set, for the same
// reason — see src/actions/grades.js / src/actions/attendance.js. Unlike
// students, that promotion is an unverified guess (no Code.gs in hand
// when it was written), so treat the removal here as provisional too:
// if the guessed schema turns out wrong, the fix is to put them back in
// this set (and STRICT_TABLES) until a real port replaces them, not to
// patch around it here.
export const SYNC_TABLES = new Set([
  "classes",
  "notifications",
]);

// UPDATE (grades/attendance action port, unverified — see
// src/actions/grades.js / attendance.js): `grades` and `attendance` were
// promoted to real typed tables the same way `students` was, and are now
// removed from SYNC_TABLES below — they have their own dedicated
// CRUD + conflict-check path instead of the generic `fields` JSON one.
//
// UPDATE (payments action port, see src/actions/payments.js): `payments`
// is ALSO removed now, for the same reason — recordNewPayment/voidPayment/
// editPayment have their own dedicated write path with their own
// version-based conflict check (payments.js checks `baseVersion` inline
// on void/edit), instead of going through syncPush.
//
// UPDATE (teacher_assignments/timetable action port, see
// src/actions/teacher_assignments.js / timetable.js): both are removed
// too, same reason — getStaffAssignments/saveStaffAssignment/
// deleteStaffAssignment and getTimetableData/saveTimetableData now have
// their own dedicated CRUD path with real typed columns, instead of the
// generic `fields` JSON shape.
//
// No table is left in STRICT_TABLES as a result — the stricter
// reject-on-stale-version rule from Section 4 (Section 6 risk:
// "Conflict resolution on grades/payments done wrong causes silent data
// loss") now lives inside grades.js/attendance.js/payments.js directly
// rather than here. If a future domain gets promoted to the generic
// engine and needs that same strictness before it has a dedicated path,
// add it back to STRICT_TABLES.
export const STRICT_TABLES = new Set([]);

function nowIso() {
  return new Date().toISOString();
}

function assertTable(table) {
  if (!SYNC_TABLES.has(table)) {
    throw new Error(`Table de synchronisation inconnue : ${table}`);
  }
}

// ---- Delta pull -----------------------------------------------------
//
// Client asks: "everything in `table` changed since `cursor`". Server
// returns the changed rows (including soft-deletes, so the client can
// remove them from IndexedDB) plus a new cursor to persist for next time.

export async function deltaPull(db, table, cursor, limit = 500) {
  assertTable(table);
  const since = cursor || "1970-01-01T00:00:00.000Z";
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 2000);

  const { results } = await db
    .prepare(
      `SELECT id, fields, version, updated_at, deleted_at FROM ${table}
       WHERE updated_at > ?
       ORDER BY updated_at ASC
       LIMIT ?`
    )
    .bind(since, capped)
    .all();

  const rows = (results || []).map((r) => ({
    id: r.id,
    version: r.version,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    deleted: !!r.deleted_at,
    fields: safeParse(r.fields),
  }));

  const nextCursor = rows.length ? rows[rows.length - 1].updatedAt : since;
  // hasMore tells the client whether to immediately re-pull instead of
  // waiting for the next sync tick — important once a table has more
  // than `limit` rows changed since a device's last sync (e.g. after
  // being offline for a week).
  const hasMore = rows.length === capped;

  return { table, rows, cursor: nextCursor, hasMore };
}

// ---- Batch push (outbox ingest) --------------------------------------
//
// entries: [{ idempotencyKey, table, op: 'upsert'|'delete', id,
//             baseVersion, fields, userId, deviceId }, ...]
//
// Each entry is applied in its own transaction-like sequence (D1's
// batch API groups statements atomically per entry) and reports back
// per-entry status so the client's outbox can mark each as
// applied/rejected/conflict individually rather than failing the
// whole batch on one bad row.

export async function applyOutboxBatch(db, entries, { userId, deviceId } = {}) {
  const outcomes = [];

  for (const entry of entries || []) {
    try {
      outcomes.push(await applyOne(db, entry, { userId, deviceId }));
    } catch (err) {
      outcomes.push({
        idempotencyKey: entry && entry.idempotencyKey,
        status: "error",
        error: err && err.message ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

async function applyOne(db, entry, { userId, deviceId }) {
  const { idempotencyKey, table, op, id } = entry || {};
  if (!idempotencyKey) throw new Error("idempotencyKey manquant.");
  assertTable(table);
  if (!id) throw new Error("id manquant.");
  if (op !== "upsert" && op !== "delete") throw new Error(`op inconnue : ${op}`);

  // Idempotency check first — a retried entry is reported as already
  // applied, never re-applied and never treated as an error.
  const already = await db
    .prepare(`SELECT 1 FROM sync_applied_ops WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first();
  if (already) {
    return { idempotencyKey, status: "already_applied", id, table };
  }

  const existing = await db
    .prepare(`SELECT version, updated_at FROM ${table} WHERE id = ?`)
    .bind(id)
    .first();

  const strict = STRICT_TABLES.has(table);
  if (existing && strict) {
    const baseVersion = Number(entry.baseVersion || 0);
    if (baseVersion !== Number(existing.version)) {
      // Reject and surface for manual merge — do not overwrite.
      return {
        idempotencyKey,
        status: "conflict",
        id,
        table,
        serverVersion: existing.version,
        serverUpdatedAt: existing.updated_at,
      };
    }
  }
  // Non-strict tables: last-write-wins by updated_at is the natural
  // effect of just overwriting here — no extra check needed.

  const ts = nowIso();
  const nextVersion = existing ? Number(existing.version) + 1 : 1;

  if (op === "delete") {
    await db
      .prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ?`)
      .bind(ts, ts, nextVersion, id)
      .run();
    if (!existing) {
      // Row never existed locally either — insert a tombstone so
      // delta-pull still reports the deletion to other devices.
      await db
        .prepare(
          `INSERT OR REPLACE INTO ${table} (id, fields, version, updated_at, deleted_at) VALUES (?, '{}', ?, ?, ?)`
        )
        .bind(id, nextVersion, ts, ts)
        .run();
    }
  } else {
    const fieldsJson = JSON.stringify(entry.fields || {});
    await db
      .prepare(
        `INSERT INTO ${table} (id, fields, version, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           fields = excluded.fields,
           version = excluded.version,
           updated_at = excluded.updated_at,
           deleted_at = NULL`
      )
      .bind(id, fieldsJson, nextVersion, ts)
      .run();
  }

  await db
    .prepare(`INSERT INTO sync_applied_ops (idempotency_key, table_name, row_id) VALUES (?, ?, ?)`)
    .bind(idempotencyKey, table, id)
    .run();

  await writeAudit(db, {
    table,
    rowId: id,
    userId,
    deviceId,
    op,
    diff: op === "upsert" ? entry.fields || {} : null,
  });

  return { idempotencyKey, status: "applied", id, table, version: nextVersion, updatedAt: ts };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
