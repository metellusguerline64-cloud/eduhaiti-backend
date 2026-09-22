// Shared org-id resolution.
//
// Extracted from the inline lookup inside src/lib/generatedIdsSync.js
// (runGeneratedIdsSync) so new domain actions — grades.js, attendance.js,
// and whatever comes after them — don't each reimplement "settings table,
// falling back to the wrangler.toml var" themselves. Same source of
// truth, same fallback order, nothing behavioral changes.
//
// One Worker deployment = one school/org (blueprint Section 5), so this
// resolves once per request rather than being passed around per-row the
// way Code.gs's getOrgId_() sometimes was.

import { getSetting } from "./settings.js";

export async function resolveOrgId(env) {
  const orgId = String((await getSetting(env.DB, "ORG_ID")) || env.ORG_ID || "").trim();
  if (!orgId) {
    throw new Error("ORG_ID non configuré (ni dans `settings`, ni dans wrangler.toml [vars]).");
  }
  return orgId;
}
