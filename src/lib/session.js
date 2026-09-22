// Port of storeSessionToken_ / loadSessionToken_ (Code.gs).
//
// The original needed two layers (CacheService for speed, PropertiesService
// as durable fallback) specifically to work around CacheService's 6h TTL
// cap. D1 has no such cap, so one table replaces both — this is a net
// simplification, not a feature loss.

const SESSION_TOKEN_TTL_SECONDS = 86400; // 24h, same default as SESSION_TOKEN_TTL_SECONDS in Code.gs

export async function storeSessionToken(db, token, payload, ttlSeconds = SESSION_TOKEN_TTL_SECONDS) {
  if (!token) return;
  const ttl = Math.max(60, Number(ttlSeconds) || SESSION_TOKEN_TTL_SECONDS);
  const expiresAt = Date.now() + ttl * 1000;

  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, email, payload, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         user_id = excluded.user_id,
         email = excluded.email,
         payload = excluded.payload,
         expires_at = excluded.expires_at`
    )
    .bind(token, payload.userId || "", payload.email || "", JSON.stringify(payload), expiresAt)
    .run();
}

export async function loadSessionToken(db, token) {
  if (!token) return null;
  const row = await db.prepare(`SELECT payload, expires_at FROM sessions WHERE token = ?`).bind(token).first();
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    // Expired — clean up lazily, same behavior as the GAS version deleting the property.
    await db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

// Port of the revocation half of _trackSessionTokenForOwner_: suspend an
// account → every session it currently holds dies immediately, instead of
// limping along until its own TTL expires.
export async function revokeSessionsForUser(db, userId) {
  if (!userId) return;
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}
