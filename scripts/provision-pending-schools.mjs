import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function run(command, args) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `${command} failed`);
  return result.stdout || "";
}

function sql(value) {
  return `'${String(value || "").replaceAll("'", "''")}'`;
}

async function runSql(statement, json = false) {
  const trimmed = statement.trim();
  const isSelect = trimmed.toUpperCase().startsWith("SELECT");

  if (isSelect) {
    // Use --command for SELECT so wrangler returns actual rows, not execution stats
    const args = ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--command", trimmed];
    if (json) args.push("--json");
    return run("npx", args);
  }

  // Use --file for non-SELECT statements (INSERT, UPDATE, etc.)
  const file = path.join(os.tmpdir(), `eduflow-provision-${process.pid}.sql`);
  await fs.writeFile(file, `${trimmed}\n`, "utf8");
  try {
    const args = ["wrangler", "d1", "execute", "meigens-master-db", "--remote", "--file", file];
    if (json) args.push("--json");
    return run("npx", args);
  } finally {
    await fs.rm(file, { force: true });
  }
}
