// Port of the tiny slice of getSaaSSettings_() / getActiveAcademicYear_()
// that the Generated_IDs sync actually touches (SYSTEM_ID_MODE,
// SYSTEM_ID_PREFIX, ACADEMIC_YEAR). The real getSaaSSettings_ in Code.gs
// read a shared multi-tenant "Register" spreadsheet with dozens of
// billing/AI-quota columns — that spreadsheet itself is retired now (see
// master-schema.sql's `orgs` table / MASTER_DB, which replaced it for
// account creation), but porting the REST of getSaaSSettings_ (billing
// plan, AI quotas, etc. — likely landing on orgs.design_json/rules_json
// or a dedicated table) is still a separate, much bigger Phase 1 task
// (org/billing admin), not part of this sync job.
// This is deliberately just a flat D1 key/value table seeded once per
// school at cutover.

export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first();
  return row ? row.value : fallback;
}

export async function getActiveAcademicYear(db) {
  // Same "ANNEE_NON_CONFIGUREE" sentinel as getActiveAcademicYear_ in
  // Code.gs, so callers can keep checking for it the same way.
  return getSetting(db, "ACADEMIC_YEAR", "ANNEE_NON_CONFIGUREE");
}
