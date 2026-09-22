import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { processUserMessage } from "../src/actions/ai_chat.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-chat-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0024_ai_token_usage.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0027_ai_chat.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0031_batch_0070_ai_keys.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key,value) VALUES ('ORG_ID','ORG1'),('DAILY_TOKEN_LIMIT','1')`).run();
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,permissions_json,active) VALUES ('u1','U1','ai@test','AI','hash','{"p_use_ai":true}',1)`).run();
db._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES ('session','u1','ai@test','{"userId":"u1","email":"ai@test"}',?)`).run(Date.now()+3600000);
const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== missing provider is checked after auth and quota ===");
const unavailable = await processUserMessage({ message: "Bonjour" }, { token: "session" }, env);
console.assert(unavailable.success === false && unavailable.error === "AI_KEY_NOT_CONFIGURED", "Provider absence should be explicit", unavailable);
const persistedAfterUnavailable = db._raw.prepare(`SELECT COUNT(*) AS total FROM ai_chat_messages`).get();
console.assert(Number(persistedAfterUnavailable.total) === 0, "Provider failure must not persist a chat message", persistedAfterUnavailable);

console.log("=== quota blocks the provider path ===");
db._raw.prepare(`INSERT INTO ai_token_usage(id,org_id,user_id,conversation_id,tokens_in,tokens_out,model,provider,created_at) VALUES ('usage','ORG1','u1','conv',1,0,'test','test',?)`).run(new Date().toISOString());
const blocked = await processUserMessage({ message: "Encore", conversationId: "conv" }, { token: "session" }, env);
console.assert(blocked.success === false && blocked.error === "AI_QUOTA_EXCEEDED", "Quota should block the call", blocked);

console.log("=== successful provider responses persist both chat roles ===");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Réponse IA" }], usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200, headers: { "content-type": "application/json" } });
env.ANTHROPIC_API_KEY = "sk-ant-test";
db._raw.prepare(`DELETE FROM ai_token_usage`).run();
const success = await processUserMessage({ message: "Question persistée", conversationId: "conv-success" }, { token: "session" }, env);
globalThis.fetch = originalFetch;
console.assert(success.success === true, "Successful provider response should return", success);
const persisted = db._raw.prepare(`SELECT role,content FROM ai_chat_messages WHERE conversation_id='conv-success' ORDER BY created_at,id`).all();
console.assert(persisted.length === 2 && persisted[0].role === "user" && persisted[1].role === "assistant", "Both chat roles should persist", persisted);

console.log("\nAll assertions passed.");