// SPDX-License-Identifier: AGPL-3.0-only
// End to end tests (PRD 18).
//
// Runs against demo mode: seed data, the mock AI provider and no login, so the whole flow
// works with no key and no network. That is the same setup a visitor gets from
// docker-compose.demo.yml, which means these tests exercise the path people actually try
// first.

import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// A throwaway database per run, so a test can act on a card without affecting the next run.
const DATA_DIR = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "aeyhey-e2e-"));

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The app is mobile first, so one pass runs at phone width.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: {
    // Seed first, then start. Seeding is idempotent, so a reused data dir is fine.
    command: `pnpm --filter @aeyhey/core demo:seed && pnpm --filter @aeyhey/web start --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: "../..",
    env: {
      DATABASE_URL: `file:${join(DATA_DIR, "e2e.db")}`,
      DATA_DIR,
      DEMO_MODE: "true",
      AI_PROVIDER: "mock",
      // The seeded demo owner has no password, which is what the demo compose does too.
      AUTH_MODE: "none",
      PUBLIC_URL: BASE_URL,
      LOG_LEVEL: "error",
    },
  },
});
