// Regression guard for scripts/provision-school.mjs's real code path:
// apply schema.sql, then every migrations/*.sql file in filename order,
// against a brand-new database — exactly what a new school gets.
//
// Five migrations (0005, 0007, 0008, 0019, 0029) are documented in their
// own header comments as additive ALTER TABLE ADD COLUMN statements that
// are no-ops on a fresh database, because schema.sql already ships the
// final column shape. provision-school.mjs's run() helper is expected to
// tolerate exactly that "duplicate column name" error for those files
// (see the allowDuplicateColumn option) and nothing else — any other
// migration failing here means a new school's automated provisioning
// (scripts/provision-pending-schools.mjs, run every 10 minutes in CI)
// will abort before wrangler.toml/tenants.js/admin user/deploy ever run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const KNOWN_NOOP_ON_FRESH_DB = new Set([
  "0005_student_history_drop_columns.sql",
  "0007_users_permissions.sql",
  "0008_users_name.sql",
  "0019_student_pin_hash.sql",
  "0029_audit_security_fields.sql",
]);

const db = new DatabaseSync(":memory:");
db.exec(fs.readFileSync("schema.sql", "utf8"));

const migrations = fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
const unexpectedFailures = [];
const noopsThatNoLongerNoop = [];

for (const file of migrations) {
  const sql = fs.readFileSync(path.join("migrations", file), "utf8");
  try {
    db.exec(sql);
  } catch (error) {
    const isDuplicateColumn = /duplicate column name/i.test(error.message);
    if (KNOWN_NOOP_ON_FRESH_DB.has(file)) {
      if (!isDuplicateColumn) noopsThatNoLongerNoop.push(`${file}: ${error.message}`);
    } else {
      unexpectedFailures.push(`${file}: ${error.message}`);
    }
  }
}

assert.equal(
  unexpectedFailures.length,
  0,
  `New migration(s) break fresh provisioning (would abort scripts/provision-school.mjs):\n${unexpectedFailures.join("\n")}`
);
assert.equal(
  noopsThatNoLongerNoop.length,
  0,
  `A documented no-op migration now fails with a different error than expected — provision-school.mjs's allowlist may need updating:\n${noopsThatNoLongerNoop.join("\n")}`
);

console.log(`provisioning blueprint-drift test: PASS (${migrations.length} migrations replayed against a fresh schema.sql, ${KNOWN_NOOP_ON_FRESH_DB.size} documented no-ops confirmed harmless)`);
