// SPDX-License-Identifier: AGPL-3.0-only
// The database client. This is the only module that knows which dialect is in play
// (PRD 15: "Keep dialect differences in src/db/ only").
//
// SQLite is the default and the one self-hosters get. Postgres turns on when
// DATABASE_URL starts with postgres://.
//
// On types: Drizzle's SQLite and Postgres clients have the same query surface for
// everything Aeyhey does, but TypeScript will not unify the two classes. Rather than
// make every call site handle a union, we expose the SQLite-typed client as the app's
// type and cast the Postgres one to it. The parity test in
// tests/unit/schema-parity.test.ts checks the two schema modules stay in step, which is
// what the cast actually depends on.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";
import { isPostgres, sqliteFilePath } from "../env";
import { createLogger } from "../logger";

const log = createLogger("db");

export type AppSchema = typeof sqliteSchema;
export type Database = BetterSQLite3Database<AppSchema>;

export type Dialect = "sqlite" | "postgres";

export interface DbHandle {
  db: Database;
  dialect: Dialect;
  schema: AppSchema;
  /** The raw driver, for the few places that need dialect-specific SQL. */
  raw: unknown;
  close(): Promise<void>;
}

let handle: DbHandle | null = null;

async function openSqlite(url: string): Promise<DbHandle> {
  const { default: BetterSqlite3 } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");

  const file = sqliteFilePath(url);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const sqlite = new BetterSqlite3(file);
  // WAL gives us concurrent readers next to the single writer, which is what the one
  // web process plus one worker process needs.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema: sqliteSchema }) as Database;
  log.info("opened sqlite", { file });

  return {
    db,
    dialect: "sqlite",
    schema: sqliteSchema,
    raw: sqlite,
    async close() {
      sqlite.close();
    },
  };
}

export interface PostgresConnection {
  url: string;
  options: { max: number; idle_timeout: number; connect_timeout: number; prepare: boolean };
}

/**
 * How to connect to a Postgres URL.
 *
 * A transaction-mode pooler (PgBouncer, Supabase's pooler on port 6543) hands each
 * statement to whichever server connection is free, so prepared statements break. Such a
 * URL is recognized by its port or by `pgbouncer=true`, which is stripped because Postgres
 * itself would reject it as an unknown setting. DATABASE_POOL_MAX caps connections per
 * process, which matters where many short-lived processes share one database.
 */
export function postgresConnection(
  databaseUrl: string,
  source: NodeJS.ProcessEnv = process.env,
): PostgresConnection {
  const parsed = new URL(databaseUrl);
  const flagged = parsed.searchParams.get("pgbouncer") === "true";
  parsed.searchParams.delete("pgbouncer");
  const pooled = flagged || parsed.port === "6543";

  const max = Number.parseInt(source.DATABASE_POOL_MAX ?? "", 10);
  return {
    url: parsed.toString(),
    options: {
      max: Number.isFinite(max) && max > 0 ? max : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: !pooled,
    },
  };
}

async function openPostgres(databaseUrl: string): Promise<DbHandle> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");

  const { url, options } = postgresConnection(databaseUrl);
  const sql = postgres(url, options);
  const db = drizzle(sql, { schema: pgSchema }) as unknown as Database;
  log.info("opened postgres");

  return {
    db,
    dialect: "postgres",
    schema: pgSchema as unknown as AppSchema,
    raw: sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export async function openDb(databaseUrl: string): Promise<DbHandle> {
  return isPostgres(databaseUrl) ? openPostgres(databaseUrl) : openSqlite(databaseUrl);
}

/** The process-wide handle. Opened once, reused by the web app and the worker. */
export async function getDb(databaseUrl?: string): Promise<DbHandle> {
  if (handle) return handle;
  const url = databaseUrl ?? process.env.DATABASE_URL ?? "file:/data/aeyhey.db";
  handle = await openDb(url);
  return handle;
}

export async function closeDb(): Promise<void> {
  if (!handle) return;
  await handle.close();
  handle = null;
}

/** Test helper, so a test can hand in an in-memory database. */
export function setDbForTests(next: DbHandle | null): void {
  handle = next;
}

export { sqliteSchema, pgSchema };
