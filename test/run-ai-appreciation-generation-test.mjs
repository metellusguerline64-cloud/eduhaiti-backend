import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { generateStudentAiAppreciation } from "../src/actions/ai_appreciations.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-appreciation-generation-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0026_ai_appreciations.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key,value) VALUES ('ORG_ID','ORG1')`).run();
db._raw.prepare(`INSERT INTO students (id,student_code,org_id,first_name,last_name,current_level,active,custom_fields) VALUES ('s1','STU-001','ORG1','Jean','Baptiste','NS1',1,'{}')`).run();
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,permissions_json,active) VALUES ('u1','U1','teacher@test','Teacher','hash','{"p_manual":true}',1)`).run();
db._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES ('session','u1','teacher@test','{"userId":"u1","email":"teacher@test"}',?)`).run(Date.now()+3600000);
const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== validation happens before provider call ===");
const noCriteria = await generateStudentAiAppreciation({ studentId: "STU-001", periodId: "T1" }, { token: "session" }, env);
console.assert(noCriteria.success === false && noCriteria.error === "MENTIONS_REQUISES", "Missing criteria should be rejected", noCriteria);
const invalidPeriod = await generateStudentAiAppreciation({ studentId: "STU-001", periodId: "T9", criteria: [{ subjectId: "math", mention: "Bien" }] }, { token: "session" }, env);
console.assert(invalidPeriod.success === false, "Invalid period should be rejected", invalidPeriod);

console.log("=== missing provider configuration is explicit ===");
const unavailable = await generateStudentAiAppreciation({ studentId: "STU-001", periodId: "T1", criteria: [{ subjectId: "math", mention: "Bien" }] }, { token: "session" }, env);
console.assert(unavailable.success === false && unavailable.error === "AI_PROVIDER_NOT_CONFIGURED", "Provider must be configured", unavailable);

console.log("\nAll assertions passed.");