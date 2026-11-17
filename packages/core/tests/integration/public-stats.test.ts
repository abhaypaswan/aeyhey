// SPDX-License-Identifier: AGPL-3.0-only
// The numbers on a public page (PRD 28): streaks, totals, milestones, and what is never
// shown.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { scopeFor, type Scope } from "../../src/repos/context";
import { saveLinks, updateLink } from "../../src/repos/links";
import { setItemTags } from "../../src/repos/tags";
import { publicPageByHandle, savePublicProfile, shareLink } from "../../src/repos/public-page";
import {
  ACTIVITY_DAYS,
  loadPublicStats,
  milestonesFor,
  streaks,
} from "../../src/repos/public-stats";

const DAY = 86_400_000;
let db: TestDb;
let scope: Scope;

const daysAgo = (n: number, now = Date.now()) => new Date(now - n * DAY);

async function read(url: string, when: Date, minutes = 10, tags: string[] = []) {
  const id = (await saveLinks(scope, { text: url })).created[0]!.id;
  await updateLink(scope, id, { status: "read", readAt: when });
  const { links } = db.handle.schema;
  const { eq } = await import("drizzle-orm");
  await db.handle.db.update(links).set({ readMinutes: minutes }).where(eq(links.id, id));
  if (tags.length) await setItemTags(scope, { type: "link", id }, tags);
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  const owner = await createOwner({ handle: db.handle, displayName: "Abhay" });
  scope = scopeFor(db.handle, owner.id);
});

afterEach(async () => {
  await db.cleanup();
});

describe("streaks", () => {
  const set = (...keys: string[]) => new Set(keys);
  const now = new Date("2026-11-16T12:00:00Z");

  it("counts a run ending today or yesterday, and the longest run anywhere", () => {
    expect(streaks(set("2026-11-14", "2026-11-15", "2026-11-16"), now)).toEqual({
      current: 3,
      longest: 3,
    });
    // Today not started yet: the run up to yesterday still counts.
    expect(streaks(set("2026-11-14", "2026-11-15"), now).current).toBe(2);
    // A missed day ends it.
    expect(streaks(set("2026-11-13", "2026-11-14"), now).current).toBe(0);
    expect(
      streaks(set("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-11-16"), now),
    ).toEqual({ current: 1, longest: 4 });
  });
});

describe("milestones", () => {
  it("keeps the best tier of each kind, most impressive first", () => {
    const earned = milestonesFor({
      longestStreak: 31,
      linksRead: 120,
      takeaways: 4,
      minutesRead: 61 * 60,
      daysActive: 70,
    });
    expect(earned.map((m) => m.label)).toEqual([
      "50 hours of reading",
      "100 links read",
      "30-day streak",
      "60 days of reading",
    ]);
    expect(earned.find((m) => m.kind === "takeaways")).toBeUndefined();
  });

  it("dates each milestone by when it was first reached", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i += 1) {
      await read(`https://example.com/${i}`, daysAgo(20 - i, now), 6);
    }
    const stats = await loadPublicStats(scope, new Date(now));
    const links = stats.milestones.find((m) => m.kind === "links");
    expect(links?.value).toBe(10);
    // The tenth read link was read 11 days ago.
    expect(links?.reachedOn).toBe(daysAgo(11, now).toISOString().slice(0, 10));
    const hours = stats.milestones.find((m) => m.kind === "hours");
    expect(hours).toBeUndefined();
  });
});

describe("loadPublicStats", () => {
  it("adds up reading, builds the activity shelf, and finds topics and sources", async () => {
    const now = Date.now();
    const a = await read("https://sqlite.org/wal.html", daysAgo(0, now), 12, ["databases"]);
    const b = await read("https://sqlite.org/fts5.html", daysAgo(1, now), 8, [
      "databases",
      "search",
    ]);
    await read("https://example.com/private", daysAgo(2, now), 30, ["secret-topic"]);
    await shareLink(scope, a, "WAL lets readers stop waiting.");
    await shareLink(scope, b, "FTS5 is built in.");

    const stats = await loadPublicStats(scope, new Date(now));
    expect(stats.linksRead).toBe(3);
    expect(stats.takeaways).toBe(2);
    expect(stats.minutesRead).toBe(50);
    expect(stats.currentStreak).toBe(3);
    expect(stats.daysActive).toBe(3);
    expect(stats.activity.counts).toHaveLength(ACTIVITY_DAYS);
    expect(stats.activity.counts.at(-1)).toBeGreaterThan(0);
    // Topics and sources come only from what was shared.
    expect(stats.topics).toEqual([
      { name: "databases", count: 2 },
      { name: "search", count: 1 },
    ]);
    expect(stats.sources).toEqual([{ name: "sqlite.org", count: 2 }]);
    // Growth over 30 days, and when the streak started.
    expect(stats.recent).toEqual({ links: 3, minutes: 50, days: 3, takeaways: 2 });
    expect(stats.streakStart).toBe(daysAgo(2, now).toISOString().slice(0, 10));
  });

  it("shows on the public page unless the owner turns it off, and never mentions questions", async () => {
    const id = await read("https://sqlite.org/wal.html", daysAgo(0), 12);
    await shareLink(scope, id, "WAL lets readers stop waiting.");
    await savePublicProfile(scope, { handle: "abhay", enabled: true });

    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page!.name).toBe("Abhay");
    expect(page!.stats?.takeaways).toBe(1);
    const text = JSON.stringify(page);
    for (const word of ["score", "grade", "question", "deck", "answer"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }

    await savePublicProfile(scope, { showStats: false });
    expect((await publicPageByHandle(db.handle, "abhay"))!.stats).toBeNull();
  });
});
