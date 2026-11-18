// SPDX-License-Identifier: AGPL-3.0-only
// The worker's safety nets: a link saved without its job gets one, and an hourly sweep
// runs once an hour even when the worker starts fresh every minute.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { scopeFor } from "../../src/repos/context";
import { saveLinks } from "../../src/repos/links";
import { enqueue, STUCK_AFTER_MS, requeueStuckLinks } from "../../src/jobs/index";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.cleanup();
});

describe("links saved without a job", () => {
  it("are queued again once they have waited a few minutes, and only once", async () => {
    const owner = await createOwner({
      handle: db.handle,
      password: "a-good-password",
      displayName: "Abhay",
    });
    const scope = scopeFor(db.handle, owner.id);
    // Saved, but the extract job was never queued: what a failed save left behind.
    const saved = await saveLinks(scope, { text: "https://example.com/stuck", note: null });
    const id = saved.created[0]!.id;

    // Too fresh: it may still be in the middle of being saved.
    expect(await requeueStuckLinks(db.handle)).toBe(0);

    const later = new Date(Date.now() + STUCK_AFTER_MS + 60_000);
    expect(await requeueStuckLinks(db.handle, later)).toBe(1);
    const { jobs } = db.handle.schema;
    const queued = await db.handle.db.select().from(jobs).where(eq(jobs.type, "extract_link"));
    expect(queued).toHaveLength(1);
    expect((queued[0]!.payload as { linkId: string }).linkId).toBe(id);

    // It has a job now, so the next sweep leaves it alone.
    expect(await requeueStuckLinks(db.handle, later)).toBe(0);
  });
});

describe("a job keyed to run once", () => {
  it("is not queued again after it finished", async () => {
    const { jobs } = db.handle.schema;
    const first = await enqueue(db.handle, {
      type: "expire_links",
      payload: {},
      dedupeKey: "expire:2026-11-18T17",
      once: true,
    });
    await db.handle.db.update(jobs).set({ status: "done" }).where(eq(jobs.id, first));

    const again = await enqueue(db.handle, {
      type: "expire_links",
      payload: {},
      dedupeKey: "expire:2026-11-18T17",
      once: true,
    });
    expect(again).toBe(first);

    // Without once, a finished job does not stop a new one.
    const fresh = await enqueue(db.handle, {
      type: "expire_links",
      payload: {},
      dedupeKey: "expire:2026-11-18T17",
    });
    expect(fresh).not.toBe(first);
  });
});
