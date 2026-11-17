// SPDX-License-Identifier: AGPL-3.0-only
// pnpm api:spec
//
// Writes docs/api/openapi.json. A test fails when the committed file is out of date, so
// run this after adding or changing an endpoint.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "./openapi";

export const SPEC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/api/openapi.json",
);

mkdirSync(dirname(SPEC_PATH), { recursive: true });
writeFileSync(SPEC_PATH, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log(`[aeyhey] wrote ${SPEC_PATH}`);
