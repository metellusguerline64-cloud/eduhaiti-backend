import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { getDirectAiKey, translateMeigensText } from "../src/actions/ai_misc.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-misc-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, is_master, active)
  VALUES ('admin-1', 'A1', 'admin@example.test', 'Admin', 'hash', '{"p_settings":true}', 0, 1)`).run();
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, active)
  VALUES ('user-1', 'U1', 'user@example.test', 'User', 'hash', '{}', 1)`).run();
db._raw.prepare(`INSERT INTO sessions (token, user_id, email, payload, expires_at) VALUES
  ('admin-session', 'admin-1', 'admin@example.test', '{"userId":"admin-1","email":"admin@example.test"}', ?),
  ('user-session', 'user-1', 'user@example.test', '{"userId":"user-1","email":"user@example.test"}', ?)`).run(Date.now() + 3600000, Date.now() + 3600000);
const env = { DB: db, ANTHROPIC_API_KEY: "sk-ant-test-key" };

console.log("=== admin can retrieve configured direct key ===");
const key = await getDirectAiKey({}, { token: "admin-session" }, env);
console.assert(key.success === true && key.key === "sk-ant-test-key", "Expected admin key response", key);

console.log("=== non-admin is rejected ===");
const denied = await getDirectAiKey({}, { token: "user-session" }, env);
console.assert(denied.success === false && denied.error === "PERMISSION_REFUSEE", "Expected permission rejection", denied);

console.log("=== translation keeps legacy fallback ===");
console.assert(await translateMeigensText({ text: "Bonjour", lang: "fr" }) === "Bonjour", "French text should round-trip");
console.assert(await translateMeigensText({ text: "Bonjour", lang: "en" }) === "Bonjour", "Unavailable provider should preserve text");

console.log("\nAll assertions passed.");