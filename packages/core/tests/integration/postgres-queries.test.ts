// SPDX-License-Identifier: AGPL-3.0-only
// Queries that read differently on Postgres, run against a real Postgres.
//
// The hosted edition runs on Postgres while the tests and most self-hosters run on
// SQLite, so a query written in SQLite's dialect passes everything here and fails only in
// production. That happened twice on 18 Nov 2026: json_extract in the job dedupe check
// stopped links from saving, and a raw Date parameter stopped the worker claiming jobs.
// These run when CORE_TEST_DATABASE_URL points at an empty Postgres database.

import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { claimNextJob, enqueue } from "../../src/jobs/queue";
import { STUCK_AFTER_MS, requeueStuckLinks } from "../../src/jobs/requeue";
import { scopeFor } from "../../src/repos/context";
import { listLinks } from "../../src/repos/links";
import { resetDemoData } from "../../src/seed/index";
import { searchLibrary } from "../../src/assistant/search";
import { listHighlights } from "../../src/repos/agent";
import { publicPageByHandle, savePublicProfile } from "../../src/repos/public-page";

const pgUrl = process.env.CORE_TEST_DATABASE_URL;

describe.skipIf(!pgUrl)("Postgres-specific queries", () => {
  it("dedupes a job by its key, and a worker can claim it", async () => {
    const pg = await openDb(pgUrl!);
    try {
      await runMigrations({ handle: pg });
      const raw = pg.raw as (strings: TemplateStringsArray) => Promise<unknown>;
      await raw`delete from jobs`;

      const key = `extract:${Date.now()}`;
      const first = await enqueue(pg, {
        type: "extract_link",
        payload: { linkId: "a" },
        dedupeKey: key,
      });
      const second = await enqueue(pg, {
        type: "extract_link",
        payload: { linkId: "a" },
        dedupeKey: key,
      });
      expect(second).toBe(first);

      const claimed = await claimNextJob(pg, "test-worker");
      expect(claimed?.id).toBe(first);
      expect(claimed?.status).toBe("running");
      expect(await claimNextJob(pg, "test-worker")).toBeNull();
    } finally {
      await pg.close();
    }
  });

  it("pages through links oldest first without repeating or skipping one", async () => {
    const pg = await openDb(pgUrl!);
    try {
      await runMigrations({ handle: pg });
      const seeded = await resetDemoData(pg);
      expect(seeded).not.toBeNull();
      const scope = scopeFor(pg, seeded!.userId);

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const result = await listLinks(scope, {
          sort: "oldest",
          limit: 5,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...result.items.map((item) => item.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(seeded!.links);

      // The assistant's library search reads JSON and page text, which differ by dialect.
      const hits = await searchLibrary(scope, "kafka partitions ordering");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((hit) => hit.kind === "question")).toBe(true);
      expect(hits.some((hit) => hit.kind === "link")).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it("draws the demo's page, and a hidden one only for its owner", async () => {
    const pg = await openDb(pgUrl!);
    try {
      await runMigrations({ handle: pg });
      const seeded = await resetDemoData(pg);
      const scope = scopeFor(pg, seeded!.userId);

      const page = await publicPageByHandle(pg, "demo");
      expect(page?.days.some((day) => day.built)).toBe(true);
      expect(await listHighlights(scope, { from: "2000-01-01" })).toHaveLength(6);

      await savePublicProfile(scope, { enabled: false });
      expect(await publicPageByHandle(pg, "demo")).toBeNull();
      expect(await publicPageByHandle(pg, "demo", { includeHidden: true })).not.toBeNull();
    } finally {
      await pg.close();
    }
  });

  it("finds links saved without a job, and runs a once-only job once", async () => {
    const pg = await openDb(pgUrl!);
    try {
      await runMigrations({ handle: pg });
      await resetDemoData(pg);
      const raw = pg.raw as (strings: TemplateStringsArray) => Promise<unknown>;
      await raw`delete from jobs`;
      await raw`update links set extract_status = 'pending' where id = (select id from links limit 1)`;
      const later = new Date(Date.now() + STUCK_AFTER_MS + 60_000);
      expect(await requeueStuckLinks(pg, later)).toBe(1);
      expect(await requeueStuckLinks(pg, later)).toBe(0);

      const first = await enqueue(pg, {
        type: "expire_links",
        payload: {},
        dedupeKey: "k",
        once: true,
      });
      await raw`update jobs set status = 'done' where type = 'expire_links'`;
      expect(
        await enqueue(pg, { type: "expire_links", payload: {}, dedupeKey: "k", once: true }),
      ).toBe(first);
    } finally {
      await pg.close();
    }
  });
});
