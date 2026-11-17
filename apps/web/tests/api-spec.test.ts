// SPDX-License-Identifier: AGPL-3.0-only
// Keeps docs/api/openapi.json true.
//
// The phone app generates its API client from that file, so an endpoint missing from it
// is an endpoint the app cannot call, and a stale file is worse than none. Two checks:
// every route file under app/api is in the manifest (and nothing extra is), and the
// committed spec is exactly what the manifest generates today.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_MANIFEST, buildOpenApi } from "@aeyhey/core/api";

const API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));
const SPEC = fileURLToPath(new URL("../../../docs/api/openapi.json", import.meta.url));

/** The plugin catch-all dispatches to whatever a plugin registers, so it has no fixed shape. */
const SKIP = new Set(["ext/[...path]"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function servedRoutes(): string[] {
  const found: string[] = [];
  for (const file of routeFiles(API_DIR)) {
    const folder = relative(API_DIR, file).split(sep).slice(0, -1).join("/");
    if (SKIP.has(folder)) continue;

    const path = "/" + folder.replace(/\[([^\]]+)\]/g, "{$1}");
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /export\s+(?:async\s+function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g,
    )) {
      found.push(`${match[1]} ${path}`);
    }
  }
  return found.sort();
}

describe("the API manifest", () => {
  it("lists every route the app serves, and nothing it does not", () => {
    const listed = API_MANIFEST.map((entry) => `${entry.method} ${entry.path}`).sort();
    expect(listed).toEqual(servedRoutes());
  });

  it("has no duplicates", () => {
    const keys = API_MANIFEST.map((entry) => `${entry.method} ${entry.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("docs/api/openapi.json", () => {
  it("matches what the manifest generates. Run `pnpm api:spec` if this fails", () => {
    const committed = JSON.parse(readFileSync(SPEC, "utf8"));
    expect(committed).toEqual(buildOpenApi());
  });
});
