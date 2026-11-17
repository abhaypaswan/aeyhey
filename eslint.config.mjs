// SPDX-License-Identifier: AGPL-3.0-only
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "packages/core/src/db/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ts-fsrs",
              message:
                "Import FSRS only inside packages/core/src/scheduler. Every due date comes from scheduler.ts (PRD 9.1).",
            },
          ],
        },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": "off",
    },
  },
  {
    // The scheduler is the one place allowed to touch ts-fsrs directly.
    files: ["packages/core/src/scheduler/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  prettier,
);
