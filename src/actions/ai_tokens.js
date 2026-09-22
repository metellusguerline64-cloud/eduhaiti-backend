import { loadViewer } from "../lib/accessScope.js";
import { resolveOrgId } from "../lib/org.js";
import { writeAudit } from "../lib/audit.js";
import { getOrgBillingRow, resolveAiTierLimits } from "../lib/orgBilling.js";

const MAX_TOKENS_PER_REQUEST = 500000;

async function viewer(env, auth) {
  return auth?.token ? loadViewer(env, auth) : null;
}

// EDGE-0091: Code.gs picked AI_*_TOKEN_LIMIT_PRO vs _FREE per org based on
// AI_PRO_ACCESS (see docs/settings-source.txt). The flat per-tenant
// `settings` DAILY_TOKEN_LIMIT/MONTHLY_TOKEN_LIMIT/SESSION_TOKEN_LIMIT keys
// still take priority when an admin has explicitly set them (same "local
// overrides master" precedence as getSaaSSettings) — MASTER_DB.orgs' PRO/
// FREE tier is only the default when no explicit override exists.
async function quotaSettings(env) {
  const { results = [] } = await env.DB.prepare(
    `SELECT key, value FROM settings
      WHERE key IN ('DAILY_TOKEN_LIMIT', 'MONTHLY_TOKEN_LIMIT', 'SESSION_TOKEN_LIMIT')`
  ).all();
  const values = Object.fromEntries(results.map((row) => [row.key, Number(row.value) || 0]));

  let tier = null;
  try {
    const orgRow = await getOrgBillingRow(env);
    if (orgRow) tier = resolveAiTierLimits(orgRow);
  } catch (_) { /* no master layer — tier stays null, defaults below apply */ }

  return {
    daily: values.DAILY_TOKEN_LIMIT || tier?.daily || 0,
    monthly: values.MONTHLY_TOKEN_LIMIT || tier?.monthly || 0,
    session: values.SESSION_TOKEN_LIMIT || tier?.session || 0,
    tier: tier?.tier || null,
  };
}

async function usage(db, orgId, userId, conversationId = "") {
  const day = new Date();
  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString();
  const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1)).toISOString();
  const daily = await db.prepare(`SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM ai_token_usage WHERE org_id=? AND created_at>=?`).bind(orgId, dayStart).first();
  const monthly = await db.prepare(`SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM ai_token_usage WHERE org_id=? AND created_at>=?`).bind(orgId, monthStart).first();
  const session = conversationId
    ? await db.prepare(`SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS total FROM ai_token_usage WHERE org_id=? AND user_id=? AND conversation_id=?`).bind(orgId, userId, conversationId).first()
    : { total: 0 };
  return { daily: Number(daily?.total) || 0, monthly: Number(monthly?.total) || 0, session: Number(session?.total) || 0 };
}

function canUseAi(v) { return !!(v && (v.isMaster || v.isGodMode || v.permissions?.p_use_ai)); }
function canManageAi(v) { return !!(v && (v.isMaster || v.isGodMode || v.permissions?.p_settings || v.permissions?.pa_save_settings)); }

export async function checkAiQuota(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return { success: false, error: "SESSION_EXPIREE" };
  if (!canUseAi(v)) return { success: false, error: "PERMISSION_REFUSEE" };
  try {
    const orgId = await resolveOrgId(env);
    const limits = await quotaSettings(env);
    const current = await usage(env.DB, orgId, v.id, String(data?.conversationId || ""));
    const allowed = (!limits.daily || current.daily < limits.daily)
      && (!limits.monthly || current.monthly < limits.monthly)
      && (!limits.session || current.session < limits.session);
    return { success: true, allowed, usage: current, limits };
  } catch (error) { return { success: true, allowed: true, error: error.message }; }
}

export async function getAiTokenStatus(data, auth, env) {
  const result = await checkAiQuota(data, auth, env);
  if (!result.success) return result;
  const limit = result.limits.daily || result.limits.monthly || 0;
  const used = result.limits.daily ? result.usage.daily : result.usage.monthly;
  return { ...result, used, limit, remaining: limit ? Math.max(0, limit - used) : 0, percentage: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0 };
}

export async function recordAiDirectTokenUsage(data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return { success: false, error: "SESSION_EXPIREE" };
  if (!canUseAi(v)) return { success: false, error: "PERMISSION_REFUSEE" };
  const tokensIn = Math.min(MAX_TOKENS_PER_REQUEST, Math.max(0, Number.parseInt(data?.tokensIn, 10) || 0));
  const tokensOut = Math.min(MAX_TOKENS_PER_REQUEST, Math.max(0, Number.parseInt(data?.tokensOut, 10) || 0));
  if (!tokensIn && !tokensOut) return { success: true, recorded: false };
  try {
    const orgId = await resolveOrgId(env);
    await env.DB.prepare(`INSERT INTO ai_token_usage (id,org_id,user_id,conversation_id,tokens_in,tokens_out,model,provider,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), orgId, v.id, String(data?.conversationId || ""), tokensIn, tokensOut, String(data?.model || "direct"), String(data?.provider || "anthropic"), new Date().toISOString()).run();
    return { success: true, recorded: true };
  } catch (error) { return { success: false, error: error.message }; }
}

export async function resetAiTokenLog(_data, auth, env) {
  const v = await viewer(env, auth);
  if (!v) return { success: false, error: "SESSION_EXPIREE" };
  if (!canManageAi(v)) return { success: false, error: "PERMISSION_REFUSEE" };
  try {
    const orgId = await resolveOrgId(env);
    const today = new Date().toISOString().slice(0, 10);
    const result = await env.DB.prepare(`DELETE FROM ai_token_usage WHERE org_id=? AND substr(created_at,1,10)=?`).bind(orgId, today).run();
    await writeAudit(env.DB, { table: "ai_token_usage", rowId: orgId, userId: v.id, op: "RESET_DAILY", diff: { deleted: result.meta?.changes || 0 } });
    return { success: true, deletedRows: result.meta?.changes || 0 };
  } catch (error) { return { success: false, error: error.message }; }
}