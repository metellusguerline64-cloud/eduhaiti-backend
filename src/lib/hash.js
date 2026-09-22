// Port of hashPin_ (Code.gs): same algorithm (SHA-256 → lowercase hex),
// just using Web Crypto instead of Utilities.computeDigest, so existing
// password hashes migrated from the Users sheet still match unchanged.
export async function hashPin(pin) {
  const enc = new TextEncoder().encode(String(pin ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
