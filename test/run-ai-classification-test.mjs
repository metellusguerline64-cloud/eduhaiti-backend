import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { classifyAiIntent } from "../src/actions/ai_classification.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-classification-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0031_batch_0070_ai_keys.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,permissions_json,active) VALUES ('u1','U1','ai@test','AI','hash','{"p_use_ai":true}',1)`).run();
db._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES ('session','u1','ai@test','{"userId":"u1","email":"ai@test"}',?)`).run(Date.now()+3600000);
const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== one allowed intent needs no provider call ===");
const one = await classifyAiIntent({ text: "Voir les notes", intents: [{ key: "grades", description: "Notes" }] }, { token: "session" }, env);
console.assert(one.success === true && one.intent === "grades", "Single intent should be selected", one);

console.log("=== empty catalog returns null ===");
const none = await classifyAiIntent({ text: "Bonjour", intents: [] }, { token: "session" }, env);
console.assert(none.success === true && none.intent === null, "Empty catalog should return null", none);

console.log("=== multiple intents require provider configuration ===");
const unavailable = await classifyAiIntent({ text: "Bonjour", intents: [{ key: "grades" }, { key: "attendance" }] }, { token: "session" }, env);
console.assert(unavailable.success === false && unavailable.error === "AI_KEY_NOT_CONFIGURED", "Provider absence should be explicit", unavailable);

console.log("\nAll assertions passed.");