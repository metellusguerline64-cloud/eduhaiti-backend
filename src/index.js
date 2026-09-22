// Port of doGet(e)'s action-handling branch (Code.gs).
//
// callApiHub_'s Path B in school.html already sends:
//   GET <httpBase>?action=X&token=Y&...otherParams
// and expects a JSON body back. This Worker reproduces that contract
// exactly so pointing SCRIPT_EXEC_URL here is close to the only frontend
// change needed (see blueprint Section 2).

import { apiHub } from "./lib/apiHub.js";
import { runGeneratedIdsSync } from "./lib/generatedIdsSync.js";
import { resolveTenantFromRequest, listTenants, scopedEnvForTenant } from "./lib/tenants.js";
import { SIGNUP_PAGE_HTML } from "./signupPage.js";
import { runDatabaseBackup } from "./actions/backup.js";
import { handleMonCashReturn } from "./actions/moncash.js";
import { getTenantBranding, buildManifestResponse, buildIconResponse } from "./lib/tenantBranding.js";

// Actions that run BEFORE any school/tenant is known — the account-
// creation interface itself. These read/write env.MASTER_DB (the shared
// control-plane database — see wrangler.toml and master-schema.sql), never
// a school's own per-tenant DB, so they must never go through
// resolveTenantFromRequest/scopedEnvForTenant below.
const ACCOUNT_ACTIONS = new Set(["registerAccount", "fetchConfig", "checkSubdomainAvailable"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // tighten to your Pages origin once routing is same-zone
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Worker-native media delivery. Files uploaded through uploadMediaFile are
    // stored in the tenant's R2 MEDIA_BUCKET (Drive is no longer required).
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/") && env.MEDIA_BUCKET) {
      const key = decodeURIComponent(url.pathname.slice("/media/".length));
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return new Response("Média introuvable.", { status: 404, headers: CORS_HEADERS });
      const headers = new Headers(CORS_HEADERS);
      object.writeHttpMetadata(headers);
      headers.set("ETag", object.httpEtag);
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    // Per-school PWA branding (EDGE-0093): manifest.json's name/short_name
    // and both icon sizes come from this subdomain's own org row
    // (business_name, logo_data_url) instead of the one shared default
    // every school used to get. See src/lib/tenantBranding.js for the
    // full rationale and the wrangler.toml routes that make this Worker
    // (rather than the Pages deployment) answer these three paths.
    if (
      request.method === "GET" &&
      (url.pathname === "/manifest.json" || url.pathname === "/icons/icon-192.png" || url.pathname === "/icons/icon-512.png")
    ) {
      const tenant = resolveTenantFromRequest(request);
      const row = tenant ? await getTenantBranding(env, tenant) : null;
      if (url.pathname === "/manifest.json") return buildManifestResponse(row, CORS_HEADERS);
      const iconFile = url.pathname.split("/").pop();
      const pagesHost = env.PAGES_TARGET_HOST || "eduflow-01k.pages.dev";
      return buildIconResponse(row, iconFile, pagesHost, CORS_HEADERS);
    }

    // Serve the account-creation interface itself. This is a temporary
    // Worker-served static page (Section 2 of the blueprint calls for
    // Cloudflare Pages eventually) — fine for now since it's one file with
    // no build step, same "single-file HTML/JS" convention as school.html.
    if (
      request.method === "GET" &&
      (url.pathname === "/" ||
        url.pathname === "/signup" ||
        url.pathname === "/inscription" ||
        url.pathname === "/api/signup" ||
        url.pathname === "/api/inscription")
    ) {
      return new Response(SIGNUP_PAGE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
      });
    }

    // Global MonCash return route. The tenant is still resolved from the
    // request Host header, so a callback can never cross school databases.
    // The school administrator never configures this route. EduHaïti owns it.
    if (request.method === "GET" && url.pathname === "/api/moncash/return") {
      const tenant = resolveTenantFromRequest(request);
      if (!tenant) return json({success:false,error:"École inconnue pour ce sous-domaine."},404);
      const tenantEnv = scopedEnvForTenant(env, tenant);
      return handleMonCashReturn(request, tenantEnv);
    }

    // Same parameter extraction as doGet: everything except action/token/auth
    // becomes `data`, mirroring e.parameter's behavior (all string values).
    let action = url.searchParams.get("action");
    const token = url.searchParams.get("token") || url.searchParams.get("auth");
    const data = {};

    if (request.method === "POST" && !action) {
      // Support a JSON POST body too, so write-heavy actions aren't forced
      // into query strings once the sync engine (Phase 3) starts batching.
      try {
        const body = await request.json();
        action = body.action;
        Object.assign(data, body.data || {});
      } catch {
        return json({ success: false, error: "Corps de requête JSON invalide." }, 400);
      }
    } else {
      for (const [key, value] of url.searchParams) {
        if (key !== "action" && key !== "token" && key !== "auth") data[key] = value;
      }
    }

    if (!action) {
      return json({ success: false, error: "Paramètre action manquant." }, 400);
    }

    // Public certificate verification. No session is required; tenant is
    // still resolved from the host so a verification code cannot cross schools.
    const certMatch = url.pathname.match(/^\/verify\/certificate\/([^/]+)\/?$/i);
    if (request.method === "GET" && certMatch) {
      const tenant = resolveTenantFromRequest(request);
      if (!tenant) return json({ success:false, verified:false, error:"École inconnue pour ce sous-domaine." }, 404);
      const tenantEnv = scopedEnvForTenant(env, tenant);
      const result = await apiHub("verifyCertificate", { verificationToken: decodeURIComponent(certMatch[1]) }, null, tenantEnv);
      return json(result);
    }

    // Account-creation actions run pre-tenant, against env.MASTER_DB —
    // skip resolveTenantFromRequest entirely (a new signup has no
    // subdomain to resolve yet, and an activation lookup by email/PIN
    // doesn't need one either).
    if (ACCOUNT_ACTIONS.has(action)) {
      const result = await apiHub(action, data, token, env);
      return json(result);
    }

    // Multi-tenant resolution: one Worker, one D1 database per school,
    // school picked by the subdomain in the Host header (see
    // lib/tenants.js). Everything past this point — apiHub, every action
    // file, org.js — reads env.DB / env.ORG_ID exactly as it did when this
    // Worker served a single school; only this scoping step is new.
    const tenant = resolveTenantFromRequest(request);
    if (!tenant) {
      return json(
        {
          success: false,
          error: "École inconnue pour ce sous-domaine. Vérifiez l'URL ou contactez l'administrateur.",
        },
        404
      );
    }
    const tenantEnv = scopedEnvForTenant(env, tenant);

    const result = await apiHub(action, data, token, tenantEnv);
    return json(result);
  },

  // Cloudflare Cron Trigger — replaces Code.gs's ScriptApp "every 10 min"
  // trigger for syncAssignedStudentsFromGeneratedIds_ (blueprint Section 1,
  // "Scheduled jobs" row). Configured in wrangler.toml under [triggers].
  //
  // Runs once per known school (no Host header to resolve a tenant from
  // here, unlike fetch()) — each iteration gets that school's own scoped
  // env, so one school's sync failing doesn't block the others.
  async scheduled(event, env, ctx) {
    for (const tenant of listTenants()) {
      const tenantEnv = scopedEnvForTenant(env, tenant);

      // Generated_IDs sync keeps its existing 10-minute cadence.
      ctx.waitUntil(
        runGeneratedIdsSync(tenantEnv, { force: false }).catch((err) => {
          console.error(`[scheduled] Generated_IDs sync failed for ${tenant.subdomain}:`, err.message);
        })
      );

      // D1 -> R2 logical backup. The backup function writes one compressed
      // snapshot per tenant. R2 is optional: when MEDIA_BUCKET is not bound,
      // the normal 10-minute sync remains unaffected.
      if (env.BACKUP_BUCKET && event?.cron === "17 2 * * *") {
        ctx.waitUntil(
          runDatabaseBackup(tenantEnv).catch((err) => {
            console.error(`[scheduled] D1 backup failed for ${tenant.subdomain}:`, err.message);
          })
        );
      }
    }
  },
};
