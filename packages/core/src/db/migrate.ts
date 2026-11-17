// SPDX-License-Identifier: AGPL-3.0-only
// Forward-only migrations, run on start and safe to run twice (PRD 16.3).
//
// Public migrations run first, then each registered plugin's migrationsDir in order
// (PRD 23.5). Nothing is ever rolled back: a mistake is fixed by a new migration.
//
// Every folder keeps its own journal. drizzle applies a migration only when it is newer
// than the newest entry in its journal, so two folders sharing one would skip each
// other's migrations whenever their dates interleave.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { DbHandle, Dialect } from "./client";
import { FTS_SETUP_SQL } from "./schema.sqlite";
import { createLogger } from "../logger";

const log = createLogger("migrate");

export interface MigrateOptions {
  handle: DbHandle;
  /** Plugins' migrations (registry.pluginMigrations), applied after the public ones. */
  plugins?: readonly { plugin: string; dir: string }[];
  migrationsRoot?: string;
}

/**
 * Where the migration SQL files are.
 *
 * This cannot be derived from import.meta.url: once this module is bundled, that points
 * inside the build output, not at the package. So we look in the places the folder
 * actually is, in order, and take the first that exists. AEYHEY_MIGRATIONS_DIR overrides
 * everything, which is the escape hatch for an unusual deployment.
 */
export function migrationsRootFor(dialect: Dialect): string {
  const leaf = dialect === "postgres" ? "pg" : "sqlite";

  const override = process.env["AEYHEY_MIGRATIONS_DIR"];
  if (override) return join(override, leaf);

  const candidates = [
    // Running from the repo root, or from a Docker image that keeps the workspace layout.
    join(process.cwd(), "packages/core/src/db/migrations", leaf),
    // Running from inside apps/web, which is what `next dev` does.
    join(process.cwd(), "../../packages/core/src/db/migrations", leaf),
    // Resolved through node_modules, which covers a published or linked package.
    join(process.cwd(), "node_modules/@aeyhey/core/src/db/migrations", leaf),
    // Last resort: relative to this file, which works when it is not bundled.
    join(dirname(fileURLToPath(import.meta.url)), "migrations", leaf),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Could not find the ${leaf} migrations. Looked in:\n${candidates.map((c) => `  ${c}`).join("\n")}\n` +
      `Set AEYHEY_MIGRATIONS_DIR to the folder that contains the "${leaf}" directory.`,
  );
}

/** The public migrations' journal, drizzle's default, kept for existing databases. */
export const CORE_MIGRATIONS_TABLE = "__drizzle_migrations";

/** "aeyhey-hosted" -> "__drizzle_migrations_aeyhey_hosted". */
export function pluginMigrationsTable(plugin: string): string {
  const slug = plugin
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) throw new Error(`A plugin name is needed for its migrations: "${plugin}".`);
  return `${CORE_MIGRATIONS_TABLE}_${slug}`;
}

async function runFolder(handle: DbHandle, folder: string, table: string): Promise<void> {
  if (!existsSync(folder)) {
    log.warn("no migrations folder, skipping", { folder });
    return;
  }
  if (handle.dialect === "postgres") {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(handle.db as never, { migrationsFolder: folder, migrationsTable: table });
  } else {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(handle.db as never, { migrationsFolder: folder, migrationsTable: table });
  }
  log.info("migrations applied", { folder, journal: table });
}

/**
 * Raw DDL this file runs itself. The app's db type is the SQLite one (see client.ts), so
 * the Postgres branch goes through this narrow escape hatch rather than widening the type
 * everywhere. The dialect check above it is what makes the cast safe.
 */
type PgExecutor = { execute(query: unknown): Promise<unknown> };

/** The FTS5 virtual table and its triggers are not something drizzle-kit generates. */
async function ensureSearchIndex(handle: DbHandle): Promise<void> {
  if (handle.dialect === "sqlite") {
    await handle.db.run(FTS_SETUP_SQL);
    log.info("sqlite fts5 index ready");
    return;
  }

  const pg = handle.db as unknown as PgExecutor;
  await pg.execute(sql`
    ALTER TABLE links ADD COLUMN IF NOT EXISTS search_tsv tsvector
      GENERATED ALWAYS AS (
        to_tsvector('english',
          coalesce(title, '') || ' ' ||
          coalesce(why_saved, '') || ' ' ||
          coalesce(user_note, '') || ' ' ||
          coalesce(left(extracted_text, 20000), ''))
      ) STORED
  `);
  await pg.execute(
    sql`CREATE INDEX IF NOT EXISTS links_search_idx ON links USING GIN (search_tsv)`,
  );
  await pg.execute(sql`
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS search_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
  `);
  await pg.execute(
    sql`CREATE INDEX IF NOT EXISTS questions_search_idx ON questions USING GIN (search_tsv)`,
  );
  log.info("postgres tsvector index ready");
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  const { handle } = options;
  await runFolder(
    handle,
    options.migrationsRoot ?? migrationsRootFor(handle.dialect),
    CORE_MIGRATIONS_TABLE,
  );
  for (const { plugin, dir } of options.plugins ?? []) {
    await runFolder(handle, dir, pluginMigrationsTable(plugin));
  }
  await ensureSearchIndex(handle);
}
