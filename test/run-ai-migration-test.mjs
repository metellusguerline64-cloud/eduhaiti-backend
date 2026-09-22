import assert from 'node:assert/strict';
import fs from 'node:fs';
import { actions } from '../src/actions/index.js';

const expected = [
  'getAiTokenStatus','checkAiQuota','recordAiDirectTokenUsage','resetAiTokenLog',
  'setUserAiApiKey','getUserAiApiKeyStatus','verifyUserAiApiKey',
  'saveStudentAiAppreciation','getStudentAiAppreciation','generateStudentAiAppreciation',
  'getDirectAiKey','translateMeigensText','classifyAiIntent','processUserMessage',
  'getAiChatConversation','getAiChatConversationList','resetAiChatConversation',
  'resetAiTokenSession','getAiChatLibraryStatus'
];
for (const name of expected) assert.equal(typeof actions[name], 'function', `${name} absent du registre`);

for (const file of ['ai_tokens.js','ai_config.js','ai_appreciations.js','ai_misc.js','ai_classification.js','ai_chat.js','ai_conversations.js']) {
  assert.ok(fs.existsSync(`src/actions/${file}`), `${file} absent`);
}

const schema = fs.readFileSync('schema.sql','utf8') + fs.readdirSync('migrations').filter(x=>x.includes('ai_')).map(x=>fs.readFileSync(`migrations/${x}`,'utf8')).join('\n');
for (const table of ['ai_token_usage','ai_user_configs','ai_appreciations','ai_chat_messages']) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} absent`);
}

for (const file of ['src/actions/ai_tokens.js','src/actions/ai_config.js','src/actions/ai_misc.js','src/actions/ai_classification.js','src/actions/ai_chat.js','src/actions/ai_appreciations.js']) {
  const text = fs.readFileSync(file,'utf8');
  assert.doesNotMatch(text, /sk-ant-[A-Za-z0-9_-]{20,}/, `${file} contient une clé Anthropic en dur`);
}

console.log(`0067 AI migration test: PASS (${expected.length} actions)`);
