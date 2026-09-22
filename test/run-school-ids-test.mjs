import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { getMySchoolId } from "../src/actions/school_ids.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-school-ids-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0023_school_ids.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO students (id, student_code, org_id, first_name, last_name, current_level, active, custom_fields)
  VALUES (?, 'MT-123', 'ORG1', 'Jean', 'Baptiste', 'NS1', 1, '{}')`).run(crypto.randomUUID());
db._raw.prepare(`INSERT INTO school_ids (id, org_id, student_code, school_id, class_name, tracking_number, photo_url, status, updated_at)
  VALUES (?, 'ORG1', 'MT123', 'SID-0007', 'NS1 A', 'TRACK-123', 'https://photo.test/jean.jpg', 'CREATED', datetime('now'))`).run(crypto.randomUUID());

const env = { DB: db, ORG_ID: "ORG1" };
const session = { token: "missing-session" };

console.log("=== invalid session is rejected ===");
const denied = await getMySchoolId({ studentId: "MT-123" }, session, env);
console.assert(denied.success === false, "Expected invalid session rejection", denied);

// A session fixture is enough for the action test; accessScope still checks
// the student's real D1 row before reading the card record.
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, active)
  VALUES ('user-1', 'U1', 'staff@example.test', 'Staff', 'hash', '{}', 1)`).run();
db._raw.prepare(`INSERT INTO sessions (token, user_id, email, payload, expires_at)
  VALUES ('valid-session', 'user-1', 'staff@example.test', '{"userId":"user-1","email":"staff@example.test"}', ?)`).run(Date.now() + 3600000);

console.log("=== normalized student code finds the school ID ===");
const found = await getMySchoolId({ studentId: "mt123" }, { token: "valid-session" }, env);
console.assert(found.success === true && found.found === true, "Expected a matching card", found);
console.assert(found.schoolId === "SID-0007" && found.trackingNumber === "TRACK-123", "Expected card fields", found);

console.log("=== unknown card returns found=false ===");
db._raw.prepare(`INSERT INTO students (id, student_code, org_id, first_name, last_name, current_level, active, custom_fields)
  VALUES (?, 'MT-124', 'ORG1', 'Marie', 'Baptiste', 'NS1', 1, '{}')`).run(crypto.randomUUID());
const missing = await getMySchoolId({ studentId: "MT-124" }, { token: "valid-session" }, env);
console.assert(missing.success === true && missing.found === false, "Expected no card for another org", missing);

console.log("\nAll assertions passed.");