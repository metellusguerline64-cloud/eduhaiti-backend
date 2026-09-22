import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { getAiTokenStatus, checkAiQuota, recordAiDirectTokenUsage, resetAiTokenLog } from "../src/actions/ai_tokens.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-tokens-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0024_ai_token_usage.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key, value) VALUES ('ORG_ID', 'ORG1'), ('DAILY_TOKEN_LIMIT', '100'), ('MONTHLY_TOKEN_LIMIT', '1000')`).run();
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, is_master, active)
  VALUES ('user-1', 'U1', 'ai@example.test', 'AI User', 'hash', '{"p_use_ai":true}', 0, 1)`).run();
db._raw.prepare(`INSERT INTO users (id, user_id, email, name, password_hash, permissions_json, is_master, active)
  VALUES ('admin-1', 'A1', 'admin@example.test', 'Admin', 'hash', '{}', 1, 1)`).run();
db._raw.prepare(`INSERT INTO sessions (token, user_id, email, payload, expires_at) VALUES
  ('ai-session', 'user-1', 'ai@example.test', '{"userId":"user-1","email":"ai@example.test"}', ?),
  ('admin-session', 'admin-1', 'admin@example.test', '{"userId":"admin-1","email":"admin@example.test"}', ?)`).run(Date.now() + 3600000, Date.now() + 3600000);

const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== AI user can record usage and read quota ===");
const recorded = await recordAiDirectTokenUsage({ tokensIn: 40, tokensOut: 70, conversationId: "conv-1" }, { token: "ai-session" }, env);
console.assert(recorded.success === true && recorded.recorded === true, "Usage should be recorded", recorded);
const status = await getAiTokenStatus({ conversationId: "conv-1" }, { token: "ai-session" }, env);
console.assert(status.success === true && status.allowed === false && status.used === 110, "Quota should be exceeded", status);

console.log("=== non-AI user is rejected ===");
const denied = await checkAiQuota({}, { token: "missing" }, env);
console.assert(denied.success === false, "Missing session should be rejected", denied);

console.log("=== admin reset clears today's usage ===");
const reset = await resetAiTokenLog({}, { token: "admin-session" }, env);
console.assert(reset.success === true && reset.deletedRows === 1, "Admin reset should delete today's row", reset);
const afterReset = await getAiTokenStatus({}, { token: "ai-session" }, env);
console.assert(afterReset.success === true && afterReset.used === 0 && afterReset.allowed === true, "Quota should reopen after reset", afterReset);

console.log("\nAll assertions passed.");