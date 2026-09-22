import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { setUserAiApiKey, getUserAiApiKeyStatus, verifyUserAiApiKey } from "../src/actions/ai_config.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-config-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0025_ai_user_configs.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1')`).run();
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, active)
  VALUES ('user-1', 'U1', 'ai@example.test', 'AI User', 'hash', '{"p_use_ai":true}', 1)`).run();
db._raw.prepare(`INSERT INTO sessions (token, user_id, email, payload, expires_at)
  VALUES ('ai-session', 'user-1', 'ai@example.test', '{"userId":"user-1","email":"ai@example.test"}', ?)`).run(Date.now() + 3600000);
const env = { DB: db, ORG_ID: "ORG1", AI_USER_CONFIG_KEY: "test-encryption-secret" };

console.log("=== AI key is encrypted at rest ===");
const saved = await setUserAiApiKey({ apiKey: "sk-secret-value", provider: "claude" }, { token: "ai-session" }, env);
console.assert(saved.success === true && saved.provider === "anthropic", "Key should be saved", saved);
const row = db._raw.prepare(`SELECT config_enc FROM ai_user_configs WHERE user_id='user-1'`).get();
console.assert(row.config_enc && !row.config_enc.includes("sk-secret-value"), "Plain API key must not be stored", row);
const status = await getUserAiApiKeyStatus({}, { token: "ai-session" }, env);
console.assert(status.configured === true && status.provider === "anthropic", "Public status should omit the secret", status);

console.log("=== missing encryption secret fails closed ===");
const noSecret = await setUserAiApiKey({ apiKey: "sk-another" }, { token: "ai-session" }, { DB: db, ORG_ID: "ORG1" });
console.assert(noSecret.success === false && /AI_USER_CONFIG_KEY/.test(noSecret.message), "Missing secret should reject storage", noSecret);
const noKey = await verifyUserAiApiKey({}, { token: "ai-session" }, { DB: db, ORG_ID: "ORG1" });
console.assert(noKey.success === false, "Verification without encryption secret should fail", noKey);

console.log("=== clearing the key removes the row ===");
const cleared = await setUserAiApiKey({ apiKey: "" }, { token: "ai-session" }, env);
console.assert(cleared.success === true, "Key should be clearable", cleared);
const afterClear = await getUserAiApiKeyStatus({}, { token: "ai-session" }, env);
console.assert(afterClear.configured === false, "Cleared key should be absent", afterClear);

console.log("\nAll assertions passed.");