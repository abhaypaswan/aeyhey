// SPDX-License-Identifier: AGPL-3.0-only
// The whole link pipeline against a real database and a real worker (PRD 8.1, 10, 15).
//
// This is the test that would have caught every integration mistake the unit tests
// cannot: a job enqueued with the wrong payload shape, a repo writing a column the
// schema does not have, a worker that claims a job twice.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db";
import { buildRegistry, type Registry } from "../../src/extensions/registry";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { loadEnv, type Env } from "../../src/env";
import { createWorker } from "../../src/jobs/worker";
import { enqueue, claimNextJob, failJob, blockJob, findJob, backoffMs } from "../../src/jobs/queue";
import {
  applyExtraction,
  findLinkById,
  linkCounts,
  listLinks,
  saveLinks,
  waitingSummaries,
} from "../../src/repos/links";
import { findCardForItem } from "../../src/repos/cards";
import { scopeFor } from "../../src/repos/context";
import { topTags } from "../../src/repos/tags";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import type { AuthProvider } from "../../src/extensions/auth";

let db: TestDb;
let userId: string;
let env: Env;
let registry: Registry;

const mockKeys: AIKeyProvider = {
  id: "mock",
  async resolve() {
    return { provider: "mock", model: "mock", source: "env" };
  },
};

const stubAuth: AuthProvider = {
  id: "stub",
  async getUser() {
    return null;
  },
  async requireUser() {
    throw new Error("no user");
  },
  async signOut() {},
};

const ARTICLE_HTML = `<!doctype html><html lang="en"><head>
<title>Choosing a Postgres index</title>
<meta property="og:site_name" content="Example Blog">
<meta name="author" content="Jane Roe">
</head><body><article><h1>Choosing a Postgres index</h1>
<p>A b-tree index is the default in Postgres and it suits equality and range lookups on ordered data. It is what you get when you write CREATE INDEX with no other words, and most of the time it is the right answer for a column you filter on.</p>
<p>A GIN index suits containment queries, which is what you want for jsonb columns and for full text search. It costs more to write and more disk, and it pays that back when your queries ask whether a document contains something specific.</p>
</article></body></html>`;

/** Serves our fixture for any host, so no test touches the network. */
function stubFetch(): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/missing")) {
      return new Response("gone", { status: 404, headers: { "content-type": "text/html" } });
    }
    return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  db = await createTestDb();
  const owner = await createOwner({ handle: db.handle, displayName: "Test", timezone: "UTC" });
  userId = owner.id;

  env = loadEnv({
    DATABASE_URL: "file::memory:",
    DATA_DIR: "/tmp",
    DEMO_MODE: "true",
    AI_PROVIDER: "mock",
    // The stub answers for every host, so the guard must let private addresses through.
    FETCH_ALLOW_PRIVATE: "true",
  } as NodeJS.ProcessEnv);

  registry = buildRegistry({
    defaults: {
      auth: stubAuth,
      aiKeys: mockKeys,
      usageGate: createAllowAllGate({ requestsPerMinute: 1000 }),
      usageSink: createLocalUsageSink(db.handle),
    },
    env: { EDITION: "community", DEMO_MODE: true },
  });
});

afterEach(async () => {
  await db.cleanup();
});

describe("saving links", () => {
  it("creates a link and a card together, so the scheduler owns it from the start", async () => {
    const scope = scopeFor(db.handle, userId);
    const result = await saveLinks(scope, { text: "https://example.com/postgres-index" });

    expect(result.created).toHaveLength(1);
    const card = await findCardForItem(scope, { type: "link", id: result.created[0]!.id });
    expect(card).not.toBeNull();
    expect(card!.status).toBe("unread");
    // A new link is due now, so it can appear in the next session (PRD 9.4).
    expect(card!.due.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("meets the acceptance criterion: 50 URLs, 5 duplicates, junk text, 45 saved", async () => {
    const scope = scopeFor(db.handle, userId);
    const unique = Array.from({ length: 45 }, (_, i) => `https://example.com/a-${i}`);
    const text = [...unique, ...unique.slice(0, 5)]
      .map((url, i) => `note ${i}: ${url}\nsome prose with no link`)
      .join("\n");

    const result = await saveLinks(scope, { text });
    expect(result.created).toHaveLength(45);

    const counts = await linkCounts(scope);
    expect(counts.unread).toBe(45);
  });

  it("reports an already saved URL rather than creating a duplicate", async () => {
    const scope = scopeFor(db.handle, userId);
    await saveLinks(scope, { text: "https://example.com/a" });

    const second = await saveLinks(scope, { text: "https://example.com/a?utm_source=x" });
    expect(second.created).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);

    const counts = await linkCounts(scope);
    expect(counts.unread).toBe(1);
  });

  it("keeps a note for a single link and drops it for many", async () => {
    const scope = scopeFor(db.handle, userId);

    const one = await saveLinks(scope, {
      text: "https://example.com/one",
      note: "for the migration",
    });
    expect((await findLinkById(scope, one.created[0]!.id))!.userNote).toBe("for the migration");

    const many = await saveLinks(scope, {
      text: "https://example.com/x https://example.com/y",
      note: "for the migration",
    });
    // One sentence cannot honestly describe why two different links were saved.
    expect((await findLinkById(scope, many.created[0]!.id))!.userNote).toBeNull();
  });

  it("keeps an imported link's original save date", async () => {
    const scope = scopeFor(db.handle, userId);
    const savedAt = new Date("2021-04-01T00:00:00Z");
    const importedAt = new Date();

    const result = await saveLinks(scope, {
      text: "https://example.com/old",
      source: "pocket",
      savedAt,
      importedAt,
    });

    const link = await findLinkById(scope, result.created[0]!.id);
    expect(link!.savedAt.toISOString()).toBe(savedAt.toISOString());
    expect(link!.importSource).toBe("pocket");
    // The expiry clock runs from the import, so a 5 year old backlog is not wiped at once.
    expect(link!.importedAt).not.toBeNull();
  });
});

describe("the pipeline, run by a real worker", () => {
  it("fetches, extracts, summarizes and tags a link", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/postgres-index" });
    const linkId = saved.created[0]!.id;

    await enqueue(db.handle, { type: "extract_link", userId, payload: { linkId } });

    // The fetcher reads the env the handler passes it, so the stub goes in here.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();

    try {
      const worker = createWorker({
        handle: db.handle,
        env,
        registry,
        maxPolls: 6,
        pollIntervalMs: 1,
      });
      await worker.run();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const link = await findLinkById(scope, linkId);
    expect(link!.extractStatus).toBe("ok");
    expect(link!.title).toBe("Choosing a Postgres index");
    expect(link!.siteName).toBe("Example Blog");
    expect(link!.author).toBe("Jane Roe");
    expect(link!.extractedText).toContain("b-tree");

    // Enrichment was queued by the extract handler and ran in the same worker pass.
    expect(link!.aiStatus).toBe("ok");
    expect(link!.summaryLines).toHaveLength(3);
    expect(link!.whySaved).toBeTruthy();
    expect(link!.readMinutes).toBeGreaterThanOrEqual(1);

    // Tags were written and are now part of the user's vocabulary.
    const tags = await topTags(scope);
    expect(tags.length).toBeGreaterThan(0);

    const listed = await listLinks(scope, { status: "unread" });
    expect(listed.items[0]!.tags.length).toBeGreaterThan(0);
  });

  it("stops showing a link as in progress once its summary job fails for good", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/postgres-index" });
    const linkId = saved.created[0]!.id;
    await applyExtraction(scope, linkId, {
      status: "ok",
      title: "Choosing a Postgres index",
      contentType: "article",
      text: "A b-tree index is the default in Postgres.",
    });
    await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId },
      maxAttempts: 1,
    });

    // A gate that breaks the way a database error would: not a block, a plain failure.
    const allowAll = createAllowAllGate({ requestsPerMinute: 1000 });
    const broken = buildRegistry({
      defaults: {
        auth: stubAuth,
        aiKeys: mockKeys,
        usageGate: {
          ...allowAll,
          async check() {
            throw new Error("the rate limit table could not be written");
          },
        },
        usageSink: createLocalUsageSink(db.handle),
      },
      env: { EDITION: "community", DEMO_MODE: true },
    });
    const worker = createWorker({
      handle: db.handle,
      env,
      registry: broken,
      maxPolls: 3,
      pollIntervalMs: 1,
    });
    await worker.run();

    const link = await findLinkById(scope, linkId);
    expect(link!.aiStatus).toBe("failed");
    expect(link!.extractStatus).not.toBe("pending");
  });

  it("keeps a link whose page could not be fetched, without guessing a summary", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/missing" });
    const linkId = saved.created[0]!.id;

    await enqueue(db.handle, { type: "extract_link", userId, payload: { linkId } });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const worker = createWorker({
        handle: db.handle,
        env,
        registry,
        maxPolls: 6,
        pollIntervalMs: 1,
      });
      await worker.run();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const link = await findLinkById(scope, linkId);
    // The page 404ed, so extraction failed, but the link and its card survive. A title
    // alone is too little to summarize, so no summary is made up from it.
    expect(link!.extractStatus).toBe("failed");
    expect(link!.title).toBe("Missing");
    expect(link!.aiStatus).toBe("skipped");
    expect(link!.summaryLines).toBeNull();

    const card = await findCardForItem(scope, { type: "link", id: linkId });
    expect(card!.status).toBe("unread");
  });

  it("skips the AI entirely when there is nothing readable to summarize", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/postgres-index" });
    // Nothing has been extracted yet: no title, no text. There is nothing to send.
    await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: saved.created[0]!.id },
    });

    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 3,
      pollIntervalMs: 1,
    });
    await worker.run();

    const link = await findLinkById(scope, saved.created[0]!.id);
    expect(link!.aiStatus).toBe("skipped");

    // No call means no usage row, which is the point: we do not spend the user's money
    // summarizing nothing.
    const usage = await db.handle.db
      .select()
      .from(db.handle.schema.aiUsage)
      .where(eq(db.handle.schema.aiUsage.userId, userId));
    expect(usage).toHaveLength(0);
  });

  it("records AI usage locally, which is what the stats page reads", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/postgres-index" });

    // Give it something to summarize, as the extract job would have.
    await applyExtraction(scope, saved.created[0]!.id, {
      status: "ok",
      title: "Choosing a Postgres index",
      contentType: "article",
      text: "A long article about b-tree and GIN indexes and when each one is the right choice.",
      language: "en",
    });

    await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: saved.created[0]!.id },
    });

    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 3,
      pollIntervalMs: 1,
    });
    await worker.run();

    const usage = await db.handle.db
      .select()
      .from(db.handle.schema.aiUsage)
      .where(eq(db.handle.schema.aiUsage.userId, userId));

    expect(usage).toHaveLength(1);
    expect(usage[0]!.task).toBe("summary");
    expect(usage[0]!.ok).toBe(true);
    expect(usage[0]!.refType).toBe("link");
  });
});

describe("the job queue", () => {
  it("says why a link's summary is waiting when its job is blocked", async () => {
    const scope = scopeFor(db.handle, userId);
    const saved = await saveLinks(scope, { text: "https://example.com/waiting" });
    const linkId = saved.created[0]!.id;
    await enqueue(db.handle, { type: "enrich_link", userId, payload: { linkId } });
    const job = (await claimNextJob(db.handle, "worker-a"))!;
    await blockJob(db.handle, job, "You are out of credits.");

    const waiting = await waitingSummaries(scope, [linkId, "another"]);
    expect([...waiting]).toEqual([[linkId, "You are out of credits."]]);

    const page = await listLinks(scope, {});
    const item = page.items.find((row) => row.id === linkId)!;
    expect(item.waitingOnCredits).toBe("You are out of credits.");
  });

  it("claims a job once, even when two workers ask at the same moment", async () => {
    await enqueue(db.handle, { type: "extract_link", userId, payload: { linkId: "l1" } });

    const [a, b] = await Promise.all([
      claimNextJob(db.handle, "worker-a"),
      claimNextJob(db.handle, "worker-b"),
    ]);

    const claimed = [a, b].filter((job) => job !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.attempts).toBe(1);
  });

  it("returns null when there is nothing to do", async () => {
    expect(await claimNextJob(db.handle, "worker-a")).toBeNull();
  });

  it("does not claim a job whose run_after is still in the future", async () => {
    await enqueue(db.handle, {
      type: "extract_link",
      userId,
      payload: { linkId: "l1" },
      runAfter: new Date(Date.now() + 60_000),
    });
    expect(await claimNextJob(db.handle, "worker-a")).toBeNull();
  });

  it("reuses a queued job with the same dedupe key", async () => {
    const first = await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: "l1" },
      dedupeKey: "enrich:l1",
    });
    const second = await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: "l1" },
      dedupeKey: "enrich:l1",
    });
    expect(second).toBe(first);
  });

  it("retries with backoff, then gives up", async () => {
    const jobId = await enqueue(db.handle, {
      type: "extract_link",
      userId,
      payload: { linkId: "l1" },
      maxAttempts: 2,
    });

    const first = await claimNextJob(db.handle, "w");
    const retry = await failJob(db.handle, first!, new Error("provider down"));
    expect(retry.willRetry).toBe(true);

    let job = await findJob(db.handle, jobId);
    expect(job!.status).toBe("queued");
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(job!.lastError).toContain("provider down");

    const giveUp = await failJob(db.handle, { ...first!, attempts: 2 }, new Error("still down"));
    expect(giveUp.willRetry).toBe(false);

    job = await findJob(db.handle, jobId);
    expect(job!.status).toBe("failed");
  });

  it("grows the backoff with each attempt", () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    // Capped, so a long outage does not push a retry a week out.
    expect(backoffMs(20)).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("blocks rather than failing, and gives the attempt back", async () => {
    const jobId = await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: "l1" },
    });

    const claimed = await claimNextJob(db.handle, "w");
    expect(claimed!.attempts).toBe(1);

    await blockJob(db.handle, claimed!, "You are out of credits.");

    const job = await findJob(db.handle, jobId);
    expect(job!.status).toBe("blocked");
    // Being out of credits must not use up the retries.
    expect(job!.attempts).toBe(0);
    expect(job!.lastError).toContain("out of credits");
  });

  it("picks a blocked job back up once its wait is over", async () => {
    const jobId = await enqueue(db.handle, {
      type: "enrich_link",
      userId,
      payload: { linkId: "l1" },
    });
    const claimed = await claimNextJob(db.handle, "w");
    await blockJob(db.handle, claimed!, "no credits", -1000);

    const again = await claimNextJob(db.handle, "w");
    expect(again?.id).toBe(jobId);
  });

  it("fails a job type nothing handles, with a message that says why", async () => {
    // import_file is a v1.1 feature with no handler yet, which is exactly the case this
    // guards: a type in the enum that nothing implements must fail loudly, not vanish.
    await enqueue(db.handle, { type: "import_file", userId, payload: {} });

    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 2,
      pollIntervalMs: 1,
    });
    await worker.run();

    const jobs = await db.handle.db.select().from(db.handle.schema.jobs);
    expect(jobs[0]!.status).toBe("failed");
    expect(jobs[0]!.lastError).toContain("No handler is registered");
  });

  it("fails a malformed payload at once instead of retrying it three times", async () => {
    await enqueue(db.handle, { type: "extract_link", userId, payload: {} });

    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 2,
      pollIntervalMs: 1,
    });
    await worker.run();

    const jobs = await db.handle.db.select().from(db.handle.schema.jobs);
    expect(jobs[0]!.status).toBe("failed");
    expect(jobs[0]!.attempts).toBe(1);
  });

  it("writes a heartbeat, which is what /api/health reports on", async () => {
    const worker = createWorker({
      handle: db.handle,
      env,
      registry,
      maxPolls: 1,
      pollIntervalMs: 1,
    });
    await worker.run();

    const beats = await db.handle.db.select().from(db.handle.schema.workerHeartbeat);
    expect(beats).toHaveLength(1);
    expect(Date.now() - beats[0]!.beatAt.getTime()).toBeLessThan(5000);
  });
});

describe("user isolation (PRD 23.7)", () => {
  it("never lets one user see or touch another's links", async () => {
    const scopeA = scopeFor(db.handle, userId);

    // A second user, created directly: createOwner refuses a second owner on purpose.
    const otherId = "user-two";
    await db.handle.db.insert(db.handle.schema.users).values({
      id: otherId,
      displayName: "Other",
      timezone: "UTC",
      role: "member",
      createdAt: new Date(),
    });
    const scopeB = scopeFor(db.handle, otherId);

    const aLink = await saveLinks(scopeA, { text: "https://example.com/mine" });
    const linkId = aLink.created[0]!.id;

    // B cannot read it by guessing the id.
    expect(await findLinkById(scopeB, linkId)).toBeNull();
    // It is not in B's inbox.
    expect((await listLinks(scopeB)).items).toHaveLength(0);
    // Nor in B's counts.
    expect((await linkCounts(scopeB)).unread).toBe(0);
    // Nor is B's card lookup able to find A's card.
    expect(await findCardForItem(scopeB, { type: "link", id: linkId })).toBeNull();

    // Both users may save the same URL without colliding.
    const bLink = await saveLinks(scopeB, { text: "https://example.com/mine" });
    expect(bLink.created).toHaveLength(1);
    expect(bLink.created[0]!.id).not.toBe(linkId);

    // And A still sees exactly one.
    expect((await listLinks(scopeA)).items).toHaveLength(1);
  });

  it("refuses a repository call with no user", () => {
    expect(() => scopeFor(db.handle, "")).toThrow(/needs a userId/i);
  });
});
