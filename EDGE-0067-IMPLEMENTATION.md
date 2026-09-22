# EDGE-0067 — AI domain migration

This release consolidates the AI domain from the real legacy `Code.gs` into the Cloudflare Worker/D1 architecture.

## Actions

Token/quota: `getAiTokenStatus`, `checkAiQuota`, `recordAiDirectTokenUsage`, `resetAiTokenLog`.

User AI configuration: `setUserAiApiKey`, `getUserAiApiKeyStatus`, `verifyUserAiApiKey`.

AI appreciation: `generateStudentAiAppreciation`, `saveStudentAiAppreciation`, `getStudentAiAppreciation`.

AI runtime: `getDirectAiKey`, `processUserMessage`, `classifyAiIntent`, `translateMeigensText`.

Conversation compatibility: `getAiChatConversation`, `getAiChatConversationList`, `resetAiChatConversation`, `resetAiTokenSession`, `getAiChatLibraryStatus`.

## Storage

- `ai_token_usage` — quota/accounting.
- `ai_user_configs` — encrypted per-user provider configuration.
- `ai_appreciations` — generated/editable student appreciations.
- `ai_chat_messages` — D1 conversation history.

The existing migrations `0024` through `0027` are retained and are not duplicated.

## Security

Provider secrets are read from Worker environment bindings. User-supplied provider keys are encrypted with `AI_USER_CONFIG_KEY` before storage. Tenant/org scoping is enforced through `resolveOrgId` and viewer access checks.

`getDirectAiKey` is retained for legacy frontend compatibility; it is administrator-only. Production deployments should prefer server-side provider calls (`processUserMessage`) so the provider secret does not need to be exposed to browser code.

## Compatibility

Action names remain compatible with the legacy `apiHub` contract. No Google Sheets, Drive, CacheService, or LanguageApp dependency is required by the migrated action modules.

`translateMeigensText` currently preserves the legacy fail-open behavior when no Cloudflare translation provider is configured; it returns the original text rather than silently inventing a translation.
