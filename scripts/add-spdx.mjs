// SPDX-License-Identifier: AGPL-3.0-only
// Adds the SPDX header to any source file that is missing it.
// Run with: node scripts/add-spdx.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const LINE = "// SPDX-License-Identifier: AGPL-3.0-only";
const ROOTS = ["packages", "apps", "scripts"];
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "coverage", "migrations"]);

let fixed = 0;

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
    if (!EXTS.has(extname(entry)) || entry.endsWith(".d.ts")) continue;
    const body = readFileSync(full, "utf8");
    if (body.includes("SPDX-License-Identifier: AGPL-3.0-only")) continue;
    const useClient = body.startsWith('"use client"') || body.startsWith("'use client'");
    if (useClient) {
      const nl = body.indexOf("\n");
      writeFileSync(full, `${body.slice(0, nl + 1)}${LINE}\n${body.slice(nl + 1)}`);
    } else {
      writeFileSync(full, `${LINE}\n${body}`);
    }
    fixed += 1;
  }
}

for (const root of ROOTS) walk(root);
console.log(`Added the SPDX header to ${fixed} file(s).`);
