// SPDX-License-Identifier: AGPL-3.0-only
// The migrations a self-hoster runs on first start (PRD 16.3).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client";
import { pluginMigrationsTable, runMigrations } from "../../src/db/migrate";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.cleanup();
});

/** Reads the table names straight out of SQLite, not out of our own schema module. */
async function tableNames(): Promise<string[]> {
  const rows = (await db.handle.db.all(
    sql`SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name`,
  )) as { name: string }[];
  return rows.map((row) => row.name);
}

describe("migrations", () => {
  it("creates every table the app expects", async () => {
    const names = await tableNames();

    for (const expected of [
      "users",
      "settings",
      "ai_providers",
      "ai_usage",
      "links",
      "question_sources",
      "decks",
      "questions",
      "tags",
      "item_tags",
      "cards",
      "grades",
      "review_logs",
      "sessions",
      "session_items",
      "push_subscriptions",
      "telegram_links",
      "telegram_messages",
      "email_channels",
      "notifications",
      "action_tokens",
      "api_tokens",
      "auth_codes",
      "devices",
      "jobs",
      "worker_heartbeat",
      "app_meta",
    ]) {
      expect(names, `missing table: ${expected}`).toContain(expected);
    }
  });

  it("creates the FTS5 search index, which drizzle-kit does not generate", async () => {
    expect(await tableNames()).toContain("search_index");
  });

  it("is safe to run twice, which is what running on every boot needs", async () => {
    await expect(runMigrations({ handle: db.handle })).resolves.toBeUndefined();
    expect(await tableNames()).toContain("links");
  });

  it("enforces one link per user per normalized URL", async () => {
    const { links } = db.handle.schema;
    const row = {
      id: "l1",
      userId: "u1",
      url: "https://example.com/a",
      urlNormalized: "https://example.com/a",
      savedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.handle.db.insert(links).values(row);
    // Same user, same URL: refused.
    await expect(db.handle.db.insert(links).values({ ...row, id: "l2" })).rejects.toThrow(
      /UNIQUE/i,
    );
    // A different user saving the same URL is fine, which is what makes the schema
    // multi-user correct (PRD 23.7).
    await expect(
      db.handle.db.insert(links).values({ ...row, id: "l3", userId: "u2" }),
    ).resolves.toBeDefined();
  });

  it("enforces one card per item", async () => {
    const { cards } = db.handle.schema;
    const row = {
      id: "c1",
      userId: "u1",
      itemType: "link" as const,
      itemId: "l1",
      due: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.handle.db.insert(cards).values(row);
    await expect(db.handle.db.insert(cards).values({ ...row, id: "c2" })).rejects.toThrow(
      /UNIQUE/i,
    );
  });

  it("makes reminder sending idempotent per user, channel and slot", async () => {
    const { notifications } = db.handle.schema;
    const slot = new Date("2026-06-01T09:00:00Z");
    const row = {
      id: "n1",
      userId: "u1",
      channel: "email" as const,
      slotTime: slot,
      createdAt: new Date(),
    };
    await db.handle.db.insert(notifications).values(row);
    // The same slot twice is exactly what a worker restart would try to do.
    await expect(db.handle.db.insert(notifications).values({ ...row, id: "n2" })).rejects.toThrow(
      /UNIQUE/i,
    );
  });

  it("round trips a JSON column and a timestamp", async () => {
    const { links } = db.handle.schema;
    const savedAt = new Date("2026-03-04T10:00:00.000Z");

    await db.handle.db.insert(links).values({
      id: "l1",
      userId: "u1",
      url: "https://example.com/a",
      urlNormalized: "https://example.com/a",
      summaryLines: ["one", "two", "three"],
      savedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const rows = await db.handle.db.select().from(links);
    expect(rows[0]!.summaryLines).toEqual(["one", "two", "three"]);
    expect(rows[0]!.savedAt.toISOString()).toBe(savedAt.toISOString());
    // Defaults from the schema actually applied.
    expect(rows[0]!.status).toBe("unread");
    expect(rows[0]!.snoozeCount).toBe(0);
    expect(rows[0]!.rescued).toBe(false);
  });
});

/** A one-migration folder in drizzle's layout, dated `when` (ms since epoch). */
function pluginFolder(table: string, when: number): string {
  const dir = mkdtempSync(join(tmpdir(), "aeyhey-plugin-migrations-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(join(dir, "0000_init.sql"), `CREATE TABLE \`${table}\` (\`id\` text PRIMARY KEY);`);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", when, tag: "0000_init", breakpoints: true }],
    }),
  );
  return dir;
}

describe("plugin migrations", () => {
  it("names each plugin's journal after the plugin", () => {
    expect(pluginMigrationsTable("aeyhey-hosted")).toBe("__drizzle_migrations_aeyhey_hosted");
    expect(() => pluginMigrationsTable("--")).toThrow();
  });

  it("applies a plugin migration dated before core's newest one", async () => {
    // With one shared journal this was skipped: drizzle only applies migrations newer than
    // the newest it has recorded, and core's are newer than this.
    const dir = pluginFolder("plugin_things", 1_600_000_000_000);
    await runMigrations({ handle: db.handle, plugins: [{ plugin: "test-plugin", dir }] });
    expect(await tableNames()).toContain("plugin_things");
    // And running again is still a no-op.
    await runMigrations({ handle: db.handle, plugins: [{ plugin: "test-plugin", dir }] });
  });
});

const pgUrl = process.env.CORE_TEST_DATABASE_URL;

describe.skipIf(!pgUrl)("migrations on Postgres", () => {
  it("creates every table and the search columns, and runs twice", async () => {
    const pg = await openDb(pgUrl!);
    try {
      await runMigrations({ handle: pg });
      await runMigrations({ handle: pg });
      const raw = pg.raw as (strings: TemplateStringsArray) => Promise<{ name: string }[]>;
      const tables = await raw`select tablename as name from pg_tables where schemaname = 'public'`;
      const names = tables.map((row) => row.name);
      for (const expected of ["users", "links", "decks", "questions", "cards", "review_logs"]) {
        expect(names).toContain(expected);
      }
      const columns = await raw`select column_name as name from information_schema.columns
        where table_name = 'links' and column_name = 'search_tsv'`;
      expect(columns).toHaveLength(1);
    } finally {
      await pg.close();
    }
  });
});
