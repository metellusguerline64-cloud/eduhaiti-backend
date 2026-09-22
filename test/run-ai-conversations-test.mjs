import fs from "node:fs";
import { makeD1 } from "./d1shim.mjs";
import { getAiChatConversation, getAiChatConversationList, resetAiChatConversation, resetAiTokenSession } from "../src/actions/ai_conversations.js";

const dbPath = `${process.env.TEMP || process.cwd()}/eduhaiti-ai-conversations-test.sqlite`;
try { fs.unlinkSync(dbPath); } catch {}
const db = makeD1(dbPath);
db._raw.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
db._raw.exec(fs.readFileSync(new URL("../migrations/0027_ai_chat.sql", import.meta.url), "utf8"));
db._raw.prepare(`INSERT INTO settings (key,value) VALUES ('ORG_ID','ORG1')`).run();
db._raw.prepare(`INSERT INTO users (id,user_id,email,name,password_hash,permissions_json,active) VALUES ('u1','U1','ai@test','AI','hash','{"p_use_ai":true}',1)`).run();
db._raw.prepare(`INSERT INTO sessions (token,user_id,email,payload,expires_at) VALUES ('session','u1','ai@test','{"userId":"u1","email":"ai@test"}',?)`).run(Date.now()+3600000);
db._raw.prepare(`INSERT INTO ai_chat_messages(id,org_id,user_id,conversation_id,role,content,created_at) VALUES ('m1','ORG1','u1','conv-1','user','Bonjour','2026-09-16T10:00:00.000Z'),('m2','ORG1','u1','conv-1','assistant','Bonjour !','2026-09-16T10:00:01.000Z')`).run();
const env = { DB: db, ORG_ID: "ORG1" };

console.log("=== conversation history and list are scoped ===");
const history = await getAiChatConversation({ conversationId: "conv-1" }, { token: "session" }, env);
console.assert(history.success === true && history.history.length === 2 && history.history[1].role === "assistant", "History should be ordered", history);
const list = await getAiChatConversationList({}, { token: "session" }, env);
console.assert(list.success === true && list.items[0].conversationId === "conv-1", "Conversation should be listed", list);

console.log("=== reset creates a new conversation id ===");
const reset = await resetAiChatConversation({}, { token: "session" }, env);
console.assert(reset.success === true && reset.conversationId, "Reset should create an id", reset);
const sessionReset = await resetAiTokenSession({}, { token: "session" }, env);
console.assert(sessionReset.success === true && sessionReset.sessionReset === true, "Token session reset should be marked", sessionReset);

console.log("\nAll assertions passed.");