// SPDX-License-Identifier: AGPL-3.0-only
// Fails if any source file under packages/ or apps/ is missing the SPDX header
// required by PRD section 26.1 step 2.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const HEADER = "SPDX-License-Identifier: AGPL-3.0-only";
const ROOTS = ["packages", "apps", "scripts"];
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "migrations",
  "playwright-report",
  "test-results",
]);

const missing = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTS.has(extname(entry))) continue;
    if (entry.endsWith(".d.ts")) continue;
    const head = readFileSync(full, "utf8").slice(0, 400);
    if (!head.includes(HEADER)) missing.push(full);
  }
}

for (const root of ROOTS) walk(root);

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" in ${missing.length} file(s):`);
  for (const f of missing) console.error(`  ${f}`);
  console.error("\nAdd it as the first line of each file.");
  process.exit(1);
}

console.log("SPDX headers: all source files are covered.");
