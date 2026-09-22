// Uses Node's built-in `node:sqlite` (available since Node 22, no
// native compile step) instead of better-sqlite3 — this environment's
// egress allowlist blocks the nodejs.org headers download node-gyp
// needs to build better-sqlite3 from source, so the native module
// isn't installable here. node:sqlite needs no build step at all and
// gives the same synchronous prepare/run/get/all shape, so the wrapper
// below (and every test file using it) is unaffected either way.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";

// A thin object that mimics enough of better-sqlite3's Database surface
// (exec, prepare().run()/get()/all()) for the one place we use it
// directly (`db._raw.exec(schema)` / ad hoc seed inserts in the tests).
function wrapRaw(raw) {
  return {
    exec(sql) {
      raw.exec(sql);
    },
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run(...args) {
          const info = stmt.run(...args);
          return { changes: Number(info.changes) };
        },
        get(...args) {
          return stmt.get(...args);
        },
        all(...args) {
          return stmt.all(...args);
        },
      };
    },
  };
}

// Just enough of the D1 prepared-statement API (bind/run/first/all) for
// our lib code to run unmodified against a real sqlite file.
export function makeD1(dbInput) {
  const dbPath = dbInput === ":memory:"
    ? dbInput
    : dbInput.startsWith("/tmp/")
      ? `${os.tmpdir()}${dbInput.slice(4).replaceAll("/", "\\")}`
      : dbInput;
  if (dbPath !== ":memory:") {
    try { fs.unlinkSync(dbPath); } catch {}
  }
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL;");
  return {
    _raw: wrapRaw(raw),
    prepare(sql) {
      const stmt = raw.prepare(sql);
      let boundArgs = [];
      const wrapper = {
        sql,
        args: [],
        bind(...args) {
          wrapper.args = args;
          boundArgs = args;
          return wrapper;
        },
        async run() {
          const info = stmt.run(...boundArgs);
          return { success: true, meta: { changes: Number(info.changes) } };
        },
        async first() {
          const row = stmt.get(...boundArgs);
          return row === undefined ? null : row;
        },
        async all() {
          const rows = stmt.all(...boundArgs);
          return { results: rows };
        },
      };
      return wrapper;
    },
    async batch(statements) {
      raw.exec('BEGIN');
      try {
        const out=[];
        for (const statement of statements) {
          const sql=statement.sql || statement;
          const args=statement.args || [];
          const st=raw.prepare(sql);
          const info=st.run(...args);
          out.push({success:true,meta:{changes:Number(info.changes)}});
        }
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch {}
        throw e;
      }
    },
  };
}
