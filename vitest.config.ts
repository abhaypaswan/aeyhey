// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@aeyhey/core": fileURLToPath(new URL("./packages/core/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["packages/**/tests/**/*.test.ts", "apps/**/tests/**/*.test.ts"],
    // .next and dist hold copies of the source, and a build output must never be a
    // second source of truth for the test run.
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.next/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/migrations/**", "**/seed/**", "**/*.d.ts"],
    },
  },
});
