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
import { scopeFor } from "../../src/repos/context";
import { listLinks } from "../../src/repos/links";
import { resetDemoData } from "../../src/seed/index";

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
    } finally {
      await pg.close();
    }
  });
});
