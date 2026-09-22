import fs from "node:fs/promises";
import path from "node:path";

function readOption(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

const source = readOption("--source", process.env.FRONTEND_SOURCE);
const apiUrl = readOption("--api-url", process.env.EDUHAITI_API_URL);
const output = readOption("--out", "frontend-dist");

if (!source) {
  console.error("Usage: node scripts/build-frontend.mjs --source <school.html> [--api-url <worker-api-url>] [--out frontend-dist]");
  process.exit(1);
}

const html = await fs.readFile(path.resolve(source), "utf8");
const headEnd = html.search(/<head\b[^>]*>/i);
if (headEnd < 0) throw new Error("Frontend HTML does not contain a <head> element.");
const tagEnd = html.indexOf(">", headEnd);
const config = apiUrl
  ? `\n<script>window.EDUHAITI_API_URL = ${JSON.stringify(apiUrl.replace(/\/+$/, "") + "/")};</script>`
  : "";
const builtHtml = html.slice(0, tagEnd + 1) + config + html.slice(tagEnd + 1);

const outputDir = path.resolve(output);
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "index.html"), builtHtml, "utf8");
console.log(`Frontend built: ${path.join(outputDir, "index.html")}`);
