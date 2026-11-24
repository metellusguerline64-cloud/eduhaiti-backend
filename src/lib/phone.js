// Canonical Haiti phone-number handling, shared by every action that
// stores, hashes, or dials a phone number (accounts.js signup/activation,
// auth.js's phone-as-temporary-password login fallback, and
// WhatsApp send). Haiti has a single 8-digit local numbering scheme, so
// "50937211234", "+509 3721-1234", "(509)37211234" and the bare "37211234"
// all identify the same subscriber — but org pin_hash / user password_hash
// values already in MASTER_DB were hashed under the OLD behavior (raw
// digits, country code kept if the person typed one), so matching logic
// must accept any of the three forms without assuming which one a given
// record was originally hashed from.

// Digits only, no country-code handling — this is the original, unchanged
// behavior used wherever a phone is first hashed and stored (registerAccount),
// so existing pin_hash/password_hash values in MASTER_DB keep matching.
export function stripDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

// The canonical 8-digit local number: strips a leading Haiti country code
// (509) when there are more than 8 digits left over. A bare 8-digit input
// is left untouched — never strip "509" out of a number that already IS
// just 8 digits. Used for NEW fields with no legacy data of their own
// (the provisioned admin's users.phone) and for building the E.164 form
// WhatsApp/SMS providers require.
export function toLocalHaiti(value) {
  const digits = stripDigits(value);
  return digits.length > 8 && digits.startsWith("509") ? digits.slice(3) : digits;
}

export function isValidHaitiPhone(digits) {
  return /^\d{8}$/.test(digits);
}

export function toE164Haiti(value) {
  const local = toLocalHaiti(value);
  return isValidHaitiPhone(local) ? `509${local}` : "";
}

// Every digit-string form a phone might have been hashed under, so a value
// typed as "509XXXXXXXX", "+509XXXXXXXX" or the bare "XXXXXXXX" always
// matches a PIN/password hash created from ANY of those forms — including
// hashes already stored before this normalization existed. Callers hash
// each candidate and accept a match against any of them.
export function phoneHashCandidates(value) {
  const raw = stripDigits(value);
  const local = toLocalHaiti(value);
  const candidates = new Set([raw]);
  if (isValidHaitiPhone(local)) {
    candidates.add(local);
    candidates.add(`509${local}`);
  }
  return [...candidates].filter(Boolean);
}
