// Helpers backing the account-creation interface (replaces
// EduHaiti_create.txt's saveClientData()/fetchConfig() pair, which read
// and wrote a shared Google Sheet). Runs against env.MASTER_DB — the one
// control-plane database shared by every org, separate from each school's
// own per-tenant D1 (see wrangler.toml and src/lib/tenants.js).

// Port of _slugify_: same "strip accents, lowercase, collapse to hyphens"
// shape as the Apps Script original, so a subdomain minted before this
// migration and one minted after look the same.
export function slugify(str) {
  const base = String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (é -> e, etc.)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

// Port of _generateUniqueSubdomain_: slugify, then append -2/-3/... on
// collision. Unlike the Sheets version (linear scan of a column), this is
// one indexed lookup per attempt against orgs.subdomain.
export async function generateUniqueSubdomain(db, businessName) {
  const base = slugify(businessName);
  let candidate = base;
  let n = 2;
  while (
    await db.prepare(`SELECT 1 FROM orgs WHERE subdomain = ? AND deleted_at IS NULL`).bind(candidate).first()
  ) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

// Port of generateBusinessId() — WITH the uniqueness check the original
// was flagged as missing ("MT" + random 4-digit number, no check against
// existing rows, collision-prone past ~90-100 schools per the birthday
// paradox). Same widen-after-failures fallback already sketched for that
// fix: try 4 digits, then 5, then 6, each for up to 50 attempts, actually
// checking orgs.business_id each time instead of trusting randomness.
export async function generateUniqueBusinessId(db) {
  for (const digits of [4, 5, 6]) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const n = Math.floor(Math.random() * 10 ** digits)
        .toString()
        .padStart(digits, "0");
      const candidate = `MT${n}`;
      const exists = await db.prepare(`SELECT 1 FROM orgs WHERE business_id = ?`).bind(candidate).first();
      if (!exists) return candidate;
    }
  }
  throw new Error("Impossible de générer un identifiant d'organisation unique.");
}

export function generateRegToken() {
  return crypto.randomUUID();
}
