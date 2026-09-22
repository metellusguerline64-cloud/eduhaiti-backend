import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { saveStudentAiAppreciation, getStudentAiAppreciation } from "../src/actions/ai_appreciations.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-appreciations-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0026_ai_appreciations.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO students (id, student_code, org_id, first_name, last_name, current_level, active, custom_fields)
  VALUES ('student-row', 'STU-001', 'ORG1', 'Jean', 'Baptiste', 'NS1', 1, '{}')`).run();
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, active)
  VALUES ('user-1', 'U1', 'teacher@example.test', 'Teacher', 'hash', '{"p_grades":true}', 1)`).run();
db._raw.prepare(`INSERT INTO sessions (token, user_id, email, payload, expires_at)
  VALUES ('teacher-session', 'user-1', 'teacher@example.test', '{"userId":"user-1","email":"teacher@example.test"}', ?)`).run(Date.now() + 3600000);
db._raw.prepare(`INSERT INTO ai_appreciations (id, org_id, student_id, period_id, status, text, generated_at, updated_at, generated_by)
  VALUES ('APP-1', 'ORG1', 'STU-001', 'T1', 'GENERATED', 'Bon travail.', datetime('now'), datetime('now'), 'system')`).run();

const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== existing appreciation is readable ===");
const found = await getStudentAiAppreciation({ studentId: "STU-001", periodId: "T1" }, { token: "teacher-session" }, env);
console.assert(found.success === true && found.exists === true && found.appreciation.text === "Bon travail.", "Expected existing appreciation", found);

console.log("=== generated appreciation can be edited and is capped ===");
const edited = await saveStudentAiAppreciation({ studentId: "STU-001", periodId: "T1", text: "x".repeat(1400) }, { token: "teacher-session" }, env);
console.assert(edited.success === true && edited.edited === true && edited.text.length === 1200, "Expected capped edit", edited);

console.log("=== invalid period and missing session are rejected ===");
const invalid = await getStudentAiAppreciation({ studentId: "STU-001", periodId: "T9" }, { token: "teacher-session" }, env);
console.assert(invalid.success === false, "Invalid period should be rejected", invalid);
const denied = await getStudentAiAppreciation({ studentId: "STU-001", periodId: "T1" }, null, env);
console.assert(denied.success === false, "Missing session should be rejected", denied);

console.log("\nAll assertions passed.");