// curriculum.js — Curriculum / matières migration from Code.gs.
//
// Ported actions:
//   getSubjectsByLevel       (kept exported here; reports.js keeps a
//                             compatibility implementation for older builds)
//   saveChunkedCurriculum   (Settings CURRICULUM_* + SCHOOL_CURRICULUM)
//
// Storage parity:
//   Code.gs stores curriculum in Settings rows named CURRICULUM_<KEY>,
//   where a value may be either a flat subject array or a nested object
//   whose keys are real level ids. SCHOOL_CURRICULUM is a derived flattened
//   snapshot. D1 uses the tenant-local settings key/value table, so no new
//   curriculum table is required.
//
// Subject shape supported by the original client/server paths:
//   { id, subjectId?, label, coeff?, branches?: [{ label, max, ... }] }
//
// The server-side coefficient invariant is deliberately preserved:
//   subject.coeff === SUM(branch.max)
// when branches exist. If it is inconsistent, branch maxima are proportionally
// rescaled and the corrected subject is returned in resyncedSubjects.

import { resolveOrgId } from "../lib/org.js";
import { loadViewer } from "../lib/accessScope.js";
import { writeAudit } from "../lib/audit.js";

function normalize(v) {
  return String(v ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseJson(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value ?? "")); }
  catch { return fallback; }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rescaleBranchMaxToTotal(branches, newTotal) {
  const list = (Array.isArray(branches) ? branches : []).map(b => ({ ...(b || {}) }));
  if (!list.length) return list;

  const target = Math.round(Number(newTotal) || 0);
  const oldVals = list.map(b => Number(b.max ?? b.coeff ?? b.points ?? b.weight ?? 0) || 0);
  const oldSum = oldVals.reduce((a, v) => a + v, 0);

  const raw = oldSum > 0
    ? oldVals.map(v => (v / oldSum) * target)
    : oldVals.map(() => target / list.length);

  const floors = raw.map(Math.floor);
  const allocated = floors.reduce((a, v) => a + v, 0);
  let remainder = target - allocated;

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const finalVals = floors.slice();
  let idx = 0;
  while (remainder > 0 && idx < order.length) {
    finalVals[order[idx].i] += 1;
    remainder -= 1;
    idx += 1;
  }

  idx = order.length - 1;
  while (remainder < 0 && idx >= 0) {
    if (finalVals[order[idx].i] > 0) {
      finalVals[order[idx].i] -= 1;
      remainder += 1;
    }
    idx -= 1;
  }

  list.forEach((b, i) => { b.max = finalVals[i]; });
  return list;
}

function normalizeCurriculumCoeffInvariant(levelPayload) {
  const resynced = [];
  const list = Array.isArray(levelPayload) ? levelPayload : [];

  for (const subject of list) {
    if (!subject || typeof subject !== "object") continue;
    const branches = Array.isArray(subject.branches) ? subject.branches : [];
    if (!branches.length) continue;

    const masterCoeff = Number(subject.coeff ?? subject.coef ?? subject.points ?? 0) || 0;
    const branchSum = branches.reduce(
      (sum, b) => sum + (Number(b?.max ?? b?.coeff ?? b?.points ?? b?.weight ?? 0) || 0),
      0
    );

    if (branchSum !== masterCoeff) {
      subject.branches = rescaleBranchMaxToTotal(branches, masterCoeff);
      resynced.push(String(subject.label ?? subject.subject ?? subject.name ?? subject.id ?? ""));
    }
  }

  return resynced;
}

// Same flattening behavior as _flattenCurriculumMap_ in Code.gs:
// flat arrays remain under their key; nested objects are unwrapped one level
// and their array children become the actual curriculum level entries.
export function flattenCurriculumMap(curriculum) {
  const out = {};
  const src = curriculum && typeof curriculum === "object" ? curriculum : {};

  for (const key of Object.keys(src)) {
    const node = src[key];
    if (Array.isArray(node)) {
      out[key] = (out[key] || []).concat(node);
      continue;
    }
    if (node && typeof node === "object") {
      for (const subKey of Object.keys(node)) {
        if (Array.isArray(node[subKey])) {
          out[subKey] = (out[subKey] || []).concat(node[subKey]);
        }
      }
    }
  }

  return out;
}

async function readCurriculumRows(db) {
  const { results } = await db.prepare(`
    SELECT key,value,updated_at
    FROM settings
    WHERE key LIKE 'CURRICULUM_%'
    ORDER BY key
  `).all();

  const rawByKey = {};
  for (const row of results || []) {
    const key = String(row.key || "").trim();
    const parsed = parseJson(row.value, null);
    if (parsed !== null && key.toUpperCase().startsWith("CURRICULUM_")) {
      rawByKey[key.slice("CURRICULUM_".length).toLowerCase()] = parsed;
    }
  }
  return { rows: results || [], curriculum: flattenCurriculumMap(rawByKey) };
}

async function readActiveCurriculum(db) {
  // Parity with _resolveActiveCurriculum_: a non-empty SCHOOL_CURRICULUM
  // takes priority; an empty {} falls back to the CURRICULUM_* rows.
  const school = await db.prepare(`SELECT value FROM settings WHERE key='SCHOOL_CURRICULUM'`).first();
  const explicit = parseJson(school?.value, null);
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit) && Object.keys(explicit).length) {
    return explicit;
  }
  return (await readCurriculumRows(db)).curriculum;
}

function subjectOutput(subject) {
  if (!subject || typeof subject !== "object") return null;
  const id = subject.subjectId ?? subject.id ?? subject.subject ?? subject.name ?? "";
  const label = subject.label ?? subject.name ?? subject.subject ?? id;
  return { id: String(id), label: String(label) };
}

export async function getSubjectsByLevel(data, auth, env) {
  try {
    const level = String(data?.level ?? (typeof data === "string" ? data : data ?? "")).trim();
    if (!level) return [];

    const curriculum = await readActiveCurriculum(env.DB);
    const direct = curriculum[level] ?? curriculum[level.toLowerCase()];
    let subjects = Array.isArray(direct) ? direct : null;

    if (!subjects) {
      const wanted = normalize(level);
      const key = Object.keys(curriculum).find(k => normalize(k) === wanted);
      subjects = key ? curriculum[key] : [];
    }

    return (subjects || []).map(subjectOutput).filter(Boolean);
  } catch {
    // Original getSubjectsByLevel_ intentionally returns [] on failure.
    return [];
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payload curriculum invalide.");
  }
  const entries = Object.entries(payload).filter(([key]) => String(key).trim());
  if (!entries.length) throw new Error("Aucun niveau de curriculum fourni.");
  return entries;
}

export async function saveChunkedCurriculum(data, auth, env) {
  if (!auth?.token) return { success: false, error: "Non authentifié." };

  try {
    const viewer = await loadViewer(env, auth);
    if (!viewer) return { success: false, error: "Session invalide." };

    const canManage = !!(
      viewer.isMaster ||
      viewer.isGodMode ||
      viewer.permissions?.pa_save_settings ||
      viewer.permissions?.p_settings
    );
    if (!canManage) return { success: false, error: "Droits insuffisants." };

    const payload = data || {};
    const entries = validatePayload(payload);
    const normalizedEntries = [];
    const resyncedSubjects = [];

    for (const [rawLevelId, rawValue] of entries) {
      const levelId = String(rawLevelId).trim();
      if (!levelId || levelId.toUpperCase() === "SCHOOL_CURRICULUM") continue;

      const value = clone(rawValue);
      const corrected = normalizeCurriculumCoeffInvariant(value);
      for (const label of corrected) {
        if (!resyncedSubjects.includes(label)) resyncedSubjects.push(label);
      }
      normalizedEntries.push({
        levelId,
        value,
        key: `CURRICULUM_${levelId.toUpperCase()}`,
      });
    }

    if (!normalizedEntries.length) {
      throw new Error("Aucun niveau de curriculum valide fourni.");
    }

    // Use a single transaction so the per-level rows and derived
    // SCHOOL_CURRICULUM snapshot cannot be left half-written.
    const now = new Date().toISOString();
    const existing = await env.DB.prepare(`
      SELECT key,value FROM settings
      WHERE key LIKE 'CURRICULUM_%'
    `).all();

    const merged = {};
    for (const row of existing.results || []) {
      const key = String(row.key || "").trim();
      const parsed = parseJson(row.value, null);
      if (parsed !== null && key.toUpperCase() !== "SCHOOL_CURRICULUM") {
        merged[key.slice("CURRICULUM_".length).toLowerCase()] = parsed;
      }
    }
    for (const item of normalizedEntries) {
      merged[item.levelId.toLowerCase()] = item.value;
    }
    const fullCurriculum = flattenCurriculumMap(merged);

    const statements = [];
    for (const item of normalizedEntries) {
      statements.push({
        sql: `INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        args: [item.key, JSON.stringify(item.value), now],
      });
    }
    statements.push({
      sql: `INSERT INTO settings(key,value,updated_at) VALUES('SCHOOL_CURRICULUM',?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      args: [JSON.stringify(fullCurriculum), now],
    });

    await env.DB.batch(statements);

    const orgId = await resolveOrgId(env);
    const actor = String(viewer.email || viewer.userId || auth.email || "").trim();
    await writeAudit(env.DB, {
      table: "settings",
      rowId: "SCHOOL_CURRICULUM",
      userId: actor || null,
      deviceId: data?.deviceId,
      op: "CURRICULUM_SAVED",
      diff: {
        orgId,
        levels: normalizedEntries.map(x => x.levelId),
        subjectCounts: normalizedEntries.map(x => ({
          levelId: x.levelId,
          count: Array.isArray(x.value) ? x.value.length : null,
        })),
        resyncedSubjects,
      },
    });

    return {
      success: true,
      levels: normalizedEntries.map(x => x.levelId),
      curriculum: fullCurriculum,
      resyncedSubjects,
    };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function getFullCurriculum(data, auth, env) {
  try {
    return { success: true, curriculum: await readActiveCurriculum(env.DB) };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
