import assert from "node:assert/strict";
import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { seedBadgeStudents } from "../src/actions/badgeSeed.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-badge-seed-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));

const env = { DB: db, ORG_ID: "ORG1", BADGE_INGEST_KEY: "secret-key" };

console.log("=== missing/blank key is rejected ===");
{
  const noKeyEnv = { DB: db, ORG_ID: "ORG1" };
  const r = await seedBadgeStudents({ students: [{ code: "E1" }] }, null, noKeyEnv);
  assert.equal(r.success, false);
  assert.match(r.error, /non configuré/);
}
{
  const r = await seedBadgeStudents({ apiKey: "wrong", students: [{ code: "E1" }] }, null, env);
  assert.equal(r.success, false);
  assert.match(r.error, /invalide/);
}

console.log("=== empty batch and over-cap batch are rejected ===");
{
  const empty = await seedBadgeStudents({ apiKey: "secret-key", students: [] }, null, env);
  assert.equal(empty.success, false);
  const tooBig = await seedBadgeStudents(
    { apiKey: "secret-key", students: Array.from({ length: 501 }, (_, i) => ({ code: "E" + i, nom: "N", prenom: "P", classe: "6e" })) },
    null,
    env
  );
  assert.equal(tooBig.success, false);
  assert.match(tooBig.error, /volumineux/);
}

console.log("=== happy path: French aliases mapped, custom fields pass through, new student created ===");
{
  const r = await seedBadgeStudents(
    {
      apiKey: "secret-key",
      students: [
        {
          code: "BDG-001",
          nom: "Pierre",
          prenom: "Jean",
          telephone: "50912345",
          sexe: "M",
          classe: "6e AF",
          CIN: "001-234567-8",
          Profession: "Cultivateur",
        },
      ],
    },
    null,
    env
  );
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.created, 1);
  assert.equal(r.failed, 0);
  const row = db._raw.prepare(`SELECT * FROM students WHERE student_code='BDG-001' AND org_id='ORG1'`).get();
  assert.ok(row, "student row should exist");
  assert.equal(row.last_name, "Pierre");
  assert.equal(row.first_name, "Jean");
  assert.equal(row.current_level, "6e AF");
  assert.equal(row.generated_source, "BadgeGeneration");
  const custom = JSON.parse(row.custom_fields || "{}");
  assert.equal(custom.CIN, "001-234567-8");
  assert.equal(custom.Profession, "Cultivateur");
}

console.log("=== accented alias (Prénom/Téléphone) also maps correctly ===");
{
  const r = await seedBadgeStudents(
    {
      apiKey: "secret-key",
      students: [{ code: "BDG-002", Nom: "Louis", "Prénom": "Marie", "Téléphone": "50999999", Classe: "5e AF" }],
    },
    null,
    env
  );
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.created, 1);
  const row = db._raw.prepare(`SELECT * FROM students WHERE student_code='BDG-002' AND org_id='ORG1'`).get();
  assert.equal(row.first_name, "Marie");
  assert.equal(row.phone, "50999999");
}

console.log("=== record missing a required field is rejected without blocking the rest of the batch ===");
{
  const r = await seedBadgeStudents(
    {
      apiKey: "secret-key",
      students: [
        { code: "BDG-003" }, // missing nom/prenom/classe
        { code: "BDG-004", nom: "Valid", prenom: "Row", classe: "4e AF" },
      ],
    },
    null,
    env
  );
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.failed, 1);
  assert.equal(r.created, 1);
  assert.match(r.errors[0].error, /nom|pr.nom|classe/);
  const ok = db._raw.prepare(`SELECT id FROM students WHERE student_code='BDG-004'`).get();
  assert.ok(ok);
  const bad = db._raw.prepare(`SELECT id FROM students WHERE student_code='BDG-003'`).get();
  assert.equal(bad, undefined);
}

console.log("=== re-sending the same code updates instead of duplicating ===");
{
  const r = await seedBadgeStudents(
    { apiKey: "secret-key", students: [{ code: "BDG-001", nom: "Pierre", prenom: "Jean", classe: "7e AF" }] },
    null,
    env
  );
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.updated, 1);
  assert.equal(r.created, 0);
  const rows = db._raw.prepare(`SELECT * FROM students WHERE student_code='BDG-001'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].current_level, "7e AF");
}

console.log("\nAll assertions passed.");
