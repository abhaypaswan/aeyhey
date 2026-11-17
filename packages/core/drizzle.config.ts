// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "drizzle-kit";

// Aeyhey ships two dialects from one schema module. Which one drizzle-kit targets
// depends on DATABASE_URL, the same rule the runtime client uses (PRD section 15).
const url = process.env.DATABASE_URL ?? "file:./data/aeyhey.db";
const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");

export default defineConfig(
  isPostgres
    ? {
        dialect: "postgresql",
        schema: "./src/db/schema.pg.ts",
        out: "./src/db/migrations/pg",
        dbCredentials: { url },
      }
    : {
        dialect: "sqlite",
        schema: "./src/db/schema.sqlite.ts",
        out: "./src/db/migrations/sqlite",
        dbCredentials: { url: url.replace(/^file:/, "") },
      },
);
