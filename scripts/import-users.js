#!/usr/bin/env node
// Converts a CSV export of the Users sheet into D1 seed SQL.
//
// Usage:
//   1. In the Users sheet: File → Download → Comma Separated Values (.csv)
//   2. node scripts/import-users.js users.csv > seed.sql
//   3. wrangler d1 execute eduhaiti-db --file=./seed.sql          (local test)
//      wrangler d1 execute eduhaiti-db --file=./seed.sql --remote (production)
//
// Column names are matched the same loose way find() does in attemptSheetLogin_
// (case-insensitive, spaces/underscores ignored) so this doesn't break if your
// sheet's headers don't match these exactly.

import fs from "node:fs";
import crypto from "node:crypto";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/import-users.js <users.csv>");
  process.exit(1);
}

function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/[\s_]/g, "");
}

function findCol(headers, names) {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const idx = normalized.indexOf(normalizeHeader(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Minimal CSV parser — good enough for a Sheets export (handles quoted
// commas). Swap for a real CSV library if your export has embedded newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(text);
const headers = rows[0];
const iEmail = findCol(headers, ["email"]);
const iUserId = findCol(headers, ["userid", "id"]);
const iUsername = findCol(headers, ["username", "login", "identifiant"]);
const iPass = findCol(headers, ["password", "motdepasse", "pass"]);
const iActive = findCol(headers, ["active", "actif"]);
const iReset = findCol(headers, ["resetreq", "reset_req", "resetrequired"]);
const iRole = findCol(headers, ["role"]);

if (iEmail === -1 || iPass === -1) {
  console.error("Could not find Email/Password columns. Headers found:", headers.join(", "));
  process.exit(1);
}

const esc = (v) => `'${String(v ?? "").replace(/'/g, "''")}'`;

const lines = [];
for (const r of rows.slice(1)) {
  if (!r[iEmail] && !r[iUserId] && !r[iUsername]) continue;
  const storedPass = String(r[iPass] || "").trim();
  // Sheet passwords are already SHA-256 hex from hashPin_ in most cases;
  // anything that isn't 64 hex chars is treated as legacy plaintext and
  // hashed here so it matches the Worker's hashPin() at login time.
  const passwordHash = /^[a-f0-9]{64}$/i.test(storedPass)
    ? storedPass.toLowerCase()
    : crypto.createHash("sha256").update(storedPass, "utf8").digest("hex");

  const id = crypto.randomUUID();
  const email = iEmail > -1 ? String(r[iEmail] || "").trim().toLowerCase() : "";
  const userId = iUserId > -1 ? String(r[iUserId] || "").trim() : "";
  const username = iUsername > -1 ? String(r[iUsername] || "").trim() : "";
  const active = iActive > -1 ? (String(r[iActive]).toUpperCase() === "FALSE" ? 0 : 1) : 1;
  const resetRequired = iReset > -1 && String(r[iReset]).toUpperCase() === "TRUE" ? 1 : 0;
  const role = iRole > -1 ? String(r[iRole] || "").trim() : "";

  lines.push(
    `INSERT INTO users (id, user_id, email, username, password_hash, role, active, reset_required) VALUES ` +
      `(${esc(id)}, ${esc(userId)}, ${esc(email)}, ${esc(username)}, ${esc(passwordHash)}, ${esc(role)}, ${active}, ${resetRequired});`
  );
}

console.log(lines.join("\n"));
console.error(`\n-- Generated ${lines.length} INSERT statements from ${csvPath}`);
