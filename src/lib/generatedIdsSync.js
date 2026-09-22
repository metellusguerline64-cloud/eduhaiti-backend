// Full port of the "Generated_IDs → students" background sync from
// Code.gs:
//   _scheduleGeneratedIdsSync_()              (throttle wrapper)
//   syncAssignedStudentsFromGeneratedIds_()   (the sync itself)
//   addNewStudent_()                          (student + history writes only)
//
// Replaces the ScriptApp "every page load, throttled by CacheService
// stamp" pattern with a real Cloudflare Cron Trigger (blueprint Section 1,
// "Scheduled jobs" row) plus a D1-backed throttle stamp as a safety net
// against overlapping manual/admin-triggered runs.
//
// Deliberately NOT ported here (out of scope for this piece — see README):
//   - syncParentAccountForStudent_ / deliverParentCredentials_ (WhatsApp
//     parent-portal auto-provisioning on new student creation)
//   - The full multi-tenant "Register" spreadsheet behind getSaaSSettings_
//     (billing plan, AI quotas, etc) — only the two settings keys this
//     job actually reads (SYSTEM_ID_MODE, SYSTEM_ID_PREFIX, ACADEMIC_YEAR)
//     are ported, via the flat `settings` D1 table (src/lib/settings.js).
//   - updateStudent_ (the dossier-edit path) — this job only ever inserts
//     brand-new students, never edits an existing one (see existingCodes
//     filter below, faithfully ported from Code.gs's own comment about
//     the "resets on page load" bug it was fixed to avoid).
//
// Both omissions return a clearly-flagged null/false field in the result
// (parentAccount: null) rather than silently doing nothing — same
// "explicit not-ported error" philosophy as the action registry.

import { fetchSheetValues as fetchSheetValuesLive } from "./sheetsApi.js";
import { getSetting, getActiveAcademicYear } from "./settings.js";

const OUTER_THROTTLE_SECONDS = 600; // 10 min — mirrors SYNC_GENIDS_STAMP in Code.gs
const INNER_THROTTLE_SECONDS = 300; // 5 min — mirrors the per-org "already synced recently" cache

// ---- Ported verbatim (same regex/logic) from Code.gs -----------------

// Exported for reuse by lookupStudentGlobal (src/actions/students.js),
// which normalizes the same Generated_IDs PhotoURL column the same way
// lookupStudentGlobal_ itself does in Code.gs — one implementation
// instead of a second copy of this regex.
export function normalizePhotoUrl(raw) {
  let photo = String(raw || "").trim();
  if (!photo) return "";
  if (photo.indexOf("drive.google.com") !== -1) {
    const m = photo.match(/id=([a-zA-Z0-9_-]+)/) || photo.match(/\/d\/([a-zA-Z0-9_-]+)\//);
    if (m) photo = "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w400";
  }
  return photo;
}

function isInactiveStatus(rawStatus) {
  const s = String(rawStatus || "").trim().toUpperCase();
  if (!s) return false;
  return /INACTIF|INACTIVE|SUSPENDU|SUSPENDED|BLOCKED|BLOQUE|DISABLED|FALSE|ARCHIVED/.test(s);
}

function normalizeHeader(x) {
  return String(x || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function newHistoryId() {
  // 'HIS-' + 8 hex chars, same shape as Utilities.getUuid().substring(0,8)
  // in Code.gs (that's the first segment of a UUID, i.e. 8 hex chars).
  return "HIS-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

async function readStamp(db, key) {
  const row = await db.prepare(`SELECT value, expires_at FROM sync_stamps WHERE key = ?`).bind(key).first();
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) return null; // expired, treat as absent
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeStamp(db, key, value, ttlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  await db
    .prepare(
      `INSERT INTO sync_stamps (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
    )
    .bind(key, JSON.stringify(value), expiresAt)
    .run();
}

// ---- addNewStudent_ (student + history slice only) --------------------

export async function upsertStudentFromGeneratedRow(db, formObj, orgId, log) {
  const studentCode = String(formObj.StudentCode || "").trim();
  if (!studentCode) throw new Error("StudentCode manquant.");

  // Port of: if (conf.SYSTEM_ID_MODE === 'AUTO') { studentCode = prefix + random(1000-9999); }
  // Kept exactly as in Code.gs even though it looks odd for this call
  // site specifically (Generated_IDs already assigns a code) — this is
  // the same branch addNewStudent_ runs for every caller, dossier form
  // included, and Code.gs didn't special-case it there either.
  const idMode = String((await getSetting(db, "SYSTEM_ID_MODE")) || "").toUpperCase();
  let effectiveCode = studentCode;
  if (idMode === "AUTO") {
    const prefix = (await getSetting(db, "SYSTEM_ID_PREFIX")) || "MT";
    effectiveCode = prefix + String(1000 + Math.floor(Math.random() * 9000));
  }

  const existing = await db
    .prepare(`SELECT id, custom_fields, created_at FROM students WHERE student_code = ? AND org_id = ? AND deleted_at IS NULL`)
    .bind(effectiveCode, orgId)
    .first();

  // Known Sheet-mapped keys vs. overflow into CustomFields — same split
  // as Code.gs's `knownKeys` check.
  const KNOWN_KEYS = new Set([
    "StudentCode", "LastName", "FirstName", "Phone", "Gender", "BirthDate",
    "Address", "PhotoURL", "CurrentLevel", "Section", "EnrollmentStatus",
    "Active", "GeneratedSource", "GeneratedOrgId",
  ]);
  const customFields = {};
  Object.keys(formObj).forEach((k) => {
    if (!KNOWN_KEYS.has(k) && k !== "CurrentLevel" && k !== "Section") customFields[k] = formObj[k];
  });

  const nowIso = new Date().toISOString();
  const photoUrl = normalizePhotoUrl(formObj.PhotoURL);
  const active = String(formObj.Active).toUpperCase() !== "FALSE" ? 1 : 0;

  let studentId; // our synthetic PK, not the business student_code
  let isNew;

  if (existing) {
    isNew = false;
    studentId = existing.id;
    // Preserve any CustomFields already on the row, merged with this
    // sync's overflow keys — same Object.assign(existing, updates) merge
    // semantics as updateStudent_, applied here for the rare re-run case.
    let mergedCustom = {};
    try {
      mergedCustom = JSON.parse(existing.custom_fields || "{}");
    } catch {
      mergedCustom = {};
    }
    Object.assign(mergedCustom, customFields);

    await db
      .prepare(
        `UPDATE students SET
           last_name = ?, first_name = ?, phone = ?, gender = ?, birth_date = ?,
           address = ?, photo_url = ?, current_level = ?, section = ?,
           enrollment_status = ?, active = ?, generated_source = ?, generated_org_id = ?,
           custom_fields = ?, version = version + 1, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        formObj.LastName || "", formObj.FirstName || "", formObj.Phone || "",
        formObj.Gender || "", formObj.BirthDate || "", formObj.Address || "",
        photoUrl, formObj.CurrentLevel || "", formObj.Section || "A",
        formObj.EnrollmentStatus || "ACTIVE", active, formObj.GeneratedSource || "",
        formObj.GeneratedOrgId || "", JSON.stringify(mergedCustom), nowIso, studentId
      )
      .run();
  } else {
    isNew = true;
    studentId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO students (
           id, student_code, org_id, last_name, first_name, phone, gender, birth_date,
           address, photo_url, current_level, section, enrollment_status, active,
           generated_source, generated_org_id, custom_fields, created_at, version, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .bind(
        studentId, effectiveCode, orgId, formObj.LastName || "", formObj.FirstName || "",
        formObj.Phone || "", formObj.Gender || "", formObj.BirthDate || "",
        formObj.Address || "", photoUrl, formObj.CurrentLevel || "", formObj.Section || "A",
        formObj.EnrollmentStatus || "ACTIVE", active, formObj.GeneratedSource || "",
        formObj.GeneratedOrgId || "", JSON.stringify(customFields), nowIso, nowIso
      )
      .run();
  }

  // Parent-portal auto-provisioning (syncParentAccountForStudent_ +
  // Parent credential delivery is handled by the PWA push channel.
  // instead of silently skipped.
  const parentAccount = null;

  // ---- student_history --------------------------------------------
  const currentYear = await getActiveAcademicYear(db);
  let historyCreated = false;
  if (currentYear !== "ANNEE_NON_CONFIGUREE") {
    const activeHist = await db
      .prepare(
        `SELECT id, grade_level_id FROM student_history
         WHERE student_id = ? AND org_id = ? AND status = 'ACTIVE' AND school_year = ?`
      )
      .bind(effectiveCode, orgId, currentYear)
      .first();

    const newLevel = String(formObj.CurrentLevel || "N/A").trim();

    if (activeHist) {
      const currentLevel = String(activeHist.grade_level_id || "").trim();
      if (currentLevel !== newLevel) {
        await db
          .prepare(`UPDATE student_history SET grade_level_id = ?, updated_at = ? WHERE id = ?`)
          .bind(newLevel, nowIso, activeHist.id)
          .run();
      }
    } else {
      await db
        .prepare(
          `INSERT INTO student_history (id, history_id, student_id, org_id, school_year, grade_level_id, section, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
        )
        .bind(
          crypto.randomUUID(), newHistoryId(), effectiveCode, orgId, currentYear,
          newLevel, formObj.Section || "A", nowIso
        )
        .run();
      historyCreated = true;
    }
  }

  // Port of writeAuditLog_('ADD_STUDENT', studentCode, ...) — reuses the
  // audit_log table built for the Phase 3 sync engine (src/lib/sync.js),
  // since "who/what/when changed" is the same concern either way.
  await db
    .prepare(
      `INSERT INTO audit_log (id, table_name, row_id, user_id, device_id, op, diff, created_at)
       VALUES (?, 'students', ?, NULL, 'cron:generated_ids_sync', ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(), effectiveCode, isNew ? "insert" : "update",
      JSON.stringify({ message: isNew ? "Inscription complete" : "Profil mis a jour" }), nowIso
    )
    .run();

  log(
    isNew
      ? `[SYNC] ✓ Created ${effectiveCode} → history written`
      : `[SYNC] ✓ Updated ${effectiveCode}`
  );

  return {
    success: true,
    studentId: effectiveCode,
    isNew,
    historyCreated,
    message: isNew ? "Inscription complete" : "Profil mis a jour",
    parentAccount,
  };
}

// ---- syncAssignedStudentsFromGeneratedIds_ (the sync itself) ---------

export async function runGeneratedIdsSync(env, options = {}) {
  const force = !!options.force;
  // Injectable for tests (test/run-sync-test.mjs) — defaults to the real
  // Sheets API call in production.
  const fetchSheetValues = options.fetchSheetValues || fetchSheetValuesLive;
  const db = env.DB;
  const logs = [];
  const log = (msg) => {
    logs.push(msg);
    console.log(msg);
  };

  log("[SYNC_START] force=" + force);

  // Outer throttle — a safety net against overlapping runs if this is
  // ever manually/admin-triggered close to a Cron tick. Cron itself
  // guarantees at most one scheduled invocation per interval, so this
  // mostly guards the manual `syncGeneratedIds` action.
  if (!force) {
    const outerStamp = await readStamp(db, "SYNC_GENIDS_STAMP");
    if (outerStamp) {
      log("[SYNC_SKIP] Ran recently (outer throttle)");
      return { success: true, skipped: true, reason: "OUTER_THROTTLED", logs };
    }
  }
  await writeStamp(db, "SYNC_GENIDS_STAMP", { at: new Date().toISOString() }, OUTER_THROTTLE_SECONDS);

  const orgId = String((await getSetting(db, "ORG_ID")) || env.ORG_ID || "").trim();
  if (!orgId) {
    log("[SYNC_SKIP] ORG_ID not available");
    return { success: true, skipped: true, reason: "ORG_ID_UNAVAILABLE", logs };
  }

  const innerKey = "SYNC_GENERATED_IDS_" + orgId;
  if (!force) {
    const cached = await readStamp(db, innerKey);
    if (cached && cached.done) {
      log("[SYNC_SKIP] Already synced recently (cached)");
      return { success: true, skipped: true, reason: "SYNC_THROTTLED", meta: cached, logs };
    }
  }

  const spreadsheetId = env.MASTER_AUTH_ID;
  if (!spreadsheetId) {
    return { success: false, error: "MASTER_AUTH_ID not configured.", logs };
  }

  let generatedData;
  try {
    generatedData = await fetchSheetValues(env, spreadsheetId, "Generated_IDs");
  } catch (err) {
    log("[SYNC_ERROR] " + err.message);
    return { success: false, error: err.message, logs };
  }

  if (!generatedData.length || generatedData.length < 2) {
    log("[SYNC_SKIP] No students in Generated_IDs sheet");
    await writeStamp(db, innerKey, { done: true, imported: 0, updated: 0, orgId }, INNER_THROTTLE_SECONDS);
    return { success: true, imported: 0, updated: 0, orgId, logs };
  }

  log("[SYNC_INFO] Found " + (generatedData.length - 1) + " rows in Generated_IDs");

  const gHeaders = generatedData[0].map(normalizeHeader);
  log("[SYNC_DEBUG] Normalized headers: " + JSON.stringify(gHeaders));

  const giId = gHeaders.indexOf("ID");
  const giNom = gHeaders.indexOf("NOM");
  const giPrenom = gHeaders.indexOf("PRENOM");
  const giPhone = gHeaders.indexOf("PHONE");
  const giOrg = gHeaders.indexOf("ORGID");
  const giPhoto = gHeaders.indexOf("PHOTOURL");
  const giStatus = gHeaders.indexOf("STATUS");
  const giClasse = gHeaders.indexOf("CLASSE");
  const giSexe = gHeaders.indexOf("SEXE");
  const giAdresse = gHeaders.indexOf("ADRESSE");
  const giBirth = gHeaders.indexOf("DATENAISSANCE") !== -1 ? gHeaders.indexOf("DATENAISSANCE") : gHeaders.indexOf("DATEDENAISSANCE");

  log(`[SYNC_DEBUG] Col indices — ID:${giId} ORG:${giOrg} CLASSE:${giClasse} BIRTH:${giBirth}`);

  if (giId === -1 || giOrg === -1) {
    return { success: false, error: "Colonnes ID/ORG ID manquantes dans Generated_IDs.", logs };
  }

  // FIX (ported verbatim as a comment for context): this sync used to
  // reprocess EVERY active row on EVERY throttled run, calling
  // addNewStudent_ for students who already exist, which silently
  // reverted any dossier edit made since the last import. Generated_IDs
  // is a one-time registration source — only import codes not yet in
  // 'students'.
  const existingRows = await db
    .prepare(`SELECT student_code FROM students WHERE org_id = ? AND deleted_at IS NULL`)
    .bind(orgId)
    .all();
  const existingCodes = new Set((existingRows.results || []).map((r) => String(r.student_code).trim()));

  const rowsToProcess = [];
  generatedData.slice(1).forEach((gRow) => {
    const rowOrgId = String(gRow[giOrg] || "").trim();
    if (!rowOrgId || rowOrgId !== orgId) return;
    if (giStatus !== -1 && isInactiveStatus(gRow[giStatus])) return;
    const code = String(gRow[giId] || "").trim();
    if (!code) return;
    if (existingCodes.has(code)) return; // already onboarded — don't re-import over edits

    rowsToProcess.push({
      StudentCode: code,
      LastName: giNom !== -1 ? String(gRow[giNom] || "").trim() : "",
      FirstName: giPrenom !== -1 ? String(gRow[giPrenom] || "").trim() : "",
      Phone: giPhone !== -1 ? String(gRow[giPhone] || "").trim() : "",
      Gender: giSexe !== -1 ? String(gRow[giSexe] || "").trim() : "",
      BirthDate: giBirth !== -1 ? gRow[giBirth] : "",
      Address: giAdresse !== -1 ? String(gRow[giAdresse] || "").trim() : "",
      PhotoURL: giPhoto !== -1 ? normalizePhotoUrl(gRow[giPhoto]) : "",
      CurrentLevel: giClasse !== -1 ? String(gRow[giClasse] || "").trim() : "",
      Section: "A",
      EnrollmentStatus: "ACTIVE",
      Active: "TRUE",
      GeneratedSource: "Generated_IDs",
      GeneratedOrgId: rowOrgId,
    });
  });

  log(`[SYNC] ${rowsToProcess.length} row(s) match orgId="${orgId}"`);

  let imported = 0;
  let updated = 0;
  let historyCreated = 0;

  for (const formObj of rowsToProcess) {
    try {
      log(`[SYNC] Calling addNewStudent_ for ${formObj.StudentCode} level="${formObj.CurrentLevel}"`);
      const result = await upsertStudentFromGeneratedRow(db, formObj, orgId, log);
      if (result.isNew) {
        imported++;
        if (result.historyCreated) historyCreated++;
      } else {
        updated++;
      }
    } catch (err) {
      log(`[SYNC] ✗ Exception for ${formObj.StudentCode}: ${err.message}`);
    }
  }

  const syncMeta = {
    done: true, imported, updated, historyCreated, orgId,
    at: new Date().toISOString(),
  };
  await writeStamp(db, innerKey, syncMeta, INNER_THROTTLE_SECONDS);

  log(`[SYNC_COMPLETE] imported=${imported} updated=${updated} historyCreated=${historyCreated}`);
  return { success: true, logs, ...syncMeta };
}
