// Entry point for the "badge generation → Cloudflare" flow you asked for:
// Google Apps Script still generates the badge (image, layout, printing —
// none of that moves). Once a badge is generated, a GAS function POSTs
// just the resulting student record here: nom, prenom, telephone, classe,
// and the Drive photo link (normalized to a thumbnail URL the same way
// generatedIdsSync.js already does it — see upsertStudentFromGeneratedRow).
//
// This is deliberately NOT the same code path as syncGeneratedIds/
// runGeneratedIdsSync (the Cron job that reads the Generated_IDs Google
// Sheet directly). That path stays as-is for whatever still relies on it.
// This one exists because you said you only need this one thing: badge
// output -> school's D1 database, nothing else, no Sheets round-trip.
//
// AUTH: this is a server-to-server call from a GAS trigger, not a logged-in
// staff member — there is no session token to check. Instead it checks a
// shared secret (env.BADGE_INGEST_KEY, a `wrangler secret put`, never a
// [vars] entry) sent as data.apiKey. It is registered in
// UNPOLICED_ACTIONS (permissions.js) precisely because the normal
// session-based permission gate does not apply here; this file is the
// substitute gate, and it fails closed (no key configured => reject, not
// "allow everyone").

import { upsertStudentFromGeneratedRow } from "../lib/generatedIdsSync.js";

const MAX_BATCH = 500; // same ceiling as syncPush's outbox batch cap

// Every alias a "known" students column might arrive under — the French
// field names the badge script uses, the accented/spaced sheet header
// names (ID_server.gs now forwards a generated_IDs row largely as-is), and
// the Code.gs-style names generatedIdsSync.js expects internally.
const FIELD_ALIASES = {
  StudentCode: ["code", "Code", "StudentCode", "studentCode"],
  LastName: ["nom", "Nom", "LastName"],
  FirstName: ["prenom", "Prénom", "Prenom", "FirstName"],
  Phone: ["telephone", "Téléphone", "Telephone", "Phone"],
  Gender: ["sexe", "Genre", "Sexe", "Gender"],
  BirthDate: ["dateNaissance", "Date de Naissance", "Date de naissance", "BirthDate"],
  Address: ["adresse", "Adresse", "Address"],
  // The Drive share link goes in as-is; upsertStudentFromGeneratedRow's
  // normalizePhotoUrl() turns it into the thumbnail URL form
  // (drive.google.com/thumbnail?id=...&sz=w400) before it's stored —
  // same conversion already used for Generated_IDs, applied here too.
  PhotoURL: ["lienPhoto", "photoUrl", "PhotoURL"],
  CurrentLevel: ["classe", "Classe", "CurrentLevel"],
  Section: ["section", "Section"],
  EnrollmentStatus: ["statut", "EnrollmentStatus"],
  Active: ["actif", "Active"],
};

function toFormObj(rec) {
  const used = new Set(["orgId", "GeneratedOrgId", "apiKey"]);
  const pick = (aliases, fallback) => {
    for (const a of aliases) {
      if (rec[a] !== undefined && rec[a] !== "" && rec[a] !== null) {
        used.add(a);
        return rec[a];
      }
    }
    return fallback;
  };

  const formObj = {
    StudentCode: pick(FIELD_ALIASES.StudentCode, ""),
    LastName: pick(FIELD_ALIASES.LastName, ""),
    FirstName: pick(FIELD_ALIASES.FirstName, ""),
    Phone: pick(FIELD_ALIASES.Phone, ""),
    Gender: pick(FIELD_ALIASES.Gender, ""),
    BirthDate: pick(FIELD_ALIASES.BirthDate, ""),
    Address: pick(FIELD_ALIASES.Address, ""),
    PhotoURL: pick(FIELD_ALIASES.PhotoURL, ""),
    CurrentLevel: pick(FIELD_ALIASES.CurrentLevel, ""),
    Section: pick(FIELD_ALIASES.Section, "A"),
    EnrollmentStatus: pick(FIELD_ALIASES.EnrollmentStatus, "ACTIVE"),
    Active: pick(FIELD_ALIASES.Active, "TRUE"),
    GeneratedSource: "BadgeGeneration",
    GeneratedOrgId: rec.orgId ?? rec.GeneratedOrgId ?? "",
  };

  // Pass-through: Jean wants everything in the sheet seeded except the
  // system-bookkeeping columns — ID_server.gs already strips those before
  // sending (_mapBadgeCardForCloudflare_), so any field left on `rec` that
  // isn't one of the known columns above (CIN, NIF, IDFamilial,
  // RelationFamiliale, "Etat Civil", Profession, an org's own custom design
  // field...) rides along as-is. upsertStudentFromGeneratedRow's own
  // KNOWN_KEYS check then routes it into the student's custom_fields JSON
  // column instead of dropping it.
  Object.keys(rec).forEach((k) => {
    if (used.has(k) || formObj[k] !== undefined) return;
    formObj[k] = rec[k];
  });

  return formObj;
}

// POST { action: "seedBadgeStudents", data: { apiKey, students: [...] } }
export async function seedBadgeStudents(data, _auth, env) {
  const providedKey = String(data.apiKey || "");
  const expectedKey = env.BADGE_INGEST_KEY || "";
  if (!expectedKey) {
    return { success: false, error: "BADGE_INGEST_KEY non configuré côté Worker (wrangler secret put)." };
  }
  if (!providedKey || providedKey !== expectedKey) {
    return { success: false, error: "Clé d'accès invalide." };
  }

  const records = Array.isArray(data.students) ? data.students : [];
  if (!records.length) {
    return { success: false, error: "Aucun élève reçu (data.students vide)." };
  }
  if (records.length > MAX_BATCH) {
    return { success: false, error: `Lot trop volumineux (${records.length}) — max ${MAX_BATCH} par appel.` };
  }

  const orgId = String(env.ORG_ID || "").trim();
  if (!orgId) {
    return { success: false, error: "ORG_ID introuvable pour cette école (résolution de tenant)." };
  }

  const logs = [];
  const log = (msg) => logs.push(msg);

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors = [];

  // One HTTP call in, one Worker request consumed — this loop then runs
  // sequential D1 statements inside that same invocation (same pattern
  // generatedIdsSync.js already uses), not one HTTP round-trip per
  // student. Quota-wise this is the "300 badges as 1 request" case from
  // our earlier conversation, not the "300 requests" one.
  for (const rec of records) {
    try {
      const formObj = toFormObj(rec);
      // Jean: nom, prénom, classe et code sont les 4 champs dont le système
      // a besoin pour fonctionner — on rejette (par enregistrement, sans
      // bloquer le reste du lot) plutôt que de semer un élève à moitié vide.
      const missing = [];
      if (!formObj.StudentCode) missing.push("code");
      if (!formObj.LastName) missing.push("nom");
      if (!formObj.FirstName) missing.push("prénom");
      if (!formObj.CurrentLevel) missing.push("classe");
      if (missing.length) throw new Error("champ(s) requis manquant(s): " + missing.join(", "));
      const result = await upsertStudentFromGeneratedRow(env.DB, formObj, orgId, log);
      if (result.isNew) created++;
      else updated++;
    } catch (err) {
      failed++;
      errors.push({ record: rec.code || rec.StudentCode || "?", error: err.message });
    }
  }

  return {
    success: true,
    received: records.length,
    created,
    updated,
    failed,
    errors,
    logs,
  };
}
