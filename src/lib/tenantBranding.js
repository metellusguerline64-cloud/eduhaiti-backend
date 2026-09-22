// Per-school PWA branding (EDGE-0093) — the manifest name and icons a
// browser's "Install app" prompt shows now come from the org's own signup
// data (business_name, logo_data_url on MASTER_DB.orgs — see
// src/actions/accounts.js's registerAccount and the signup form's logo
// upload field) instead of the single shared default every subdomain
// served before this.
//
// Every subdomain still points at the same Cloudflare Pages deployment
// (frontend-dist) for the app shell itself (index.html, sw.js, JS
// bundles) — only /manifest.json, /icons/icon-192.png and
// /icons/icon-512.png are intercepted by this Worker (see the extra
// [[routes]] entries in wrangler.toml and the handler in src/index.js).
// Workers routes always take priority over Pages for a matched path on
// the same zone, so this works with zero change to the Pages deployment
// or index.html, which already references href="/manifest.json".

// Looks up this tenant's business_name + logo_data_url from MASTER_DB.
// Returns null on any failure (no MASTER_DB binding, row not found, org
// not yet provisioned) — callers treat that the same as "no branding
// override", falling back to the shared EduHaïti default.
export async function getTenantBranding(env, tenant) {
  if (!env?.MASTER_DB || !tenant?.orgId) return null;
  try {
    return await env.MASTER_DB.prepare(
      `SELECT business_name, logo_data_url FROM orgs WHERE business_id = ? AND deleted_at IS NULL LIMIT 1`
    )
      .bind(tenant.orgId)
      .first();
  } catch (_) {
    return null;
  }
}

// PWA short_name is meant to be compact (recommended ~12 chars) — it's
// what shows under the home-screen icon once installed, where a long
// business name gets truncated by the OS anyway.
function shortName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "EduHaïti";
  return trimmed.length <= 12 ? trimmed : trimmed.slice(0, 12);
}

export function buildManifestResponse(row, corsHeaders) {
  const name = (row && row.business_name && String(row.business_name).trim()) || "EduHaïti";
  const manifest = {
    name,
    short_name: shortName(name),
    description: `Application ${name} — fonctionne hors connexion après la première ouverture.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9fc",
    theme_color: "#1C1152",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
  });
}

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/s;

// iconFile is "icon-192.png" or "icon-512.png" (matched from the request
// path in src/index.js) — used only for the no-custom-logo fallback below.
export function buildIconResponse(row, iconFile, pagesHost, corsHeaders) {
  const dataUrl = row && row.logo_data_url ? String(row.logo_data_url) : "";
  const match = dataUrl.match(DATA_URL_RE);
  if (!match) {
    // No logo uploaded at signup (or org not found) — redirect straight to
    // the Pages deployment's own default icon, NOT back to this same path
    // on this zone (that would loop, since this Worker's route always
    // wins over Pages for /icons/icon-*.png on *.eduflow.win).
    return Response.redirect(`https://${pagesHost}/icons/${iconFile}`, 302);
  }
  const [, mimeType, base64] = match;
  // Worker runtime has atob() globally — no Buffer needed.
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=300",
      ...corsHeaders,
    },
  });
}
