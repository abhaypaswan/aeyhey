// SPDX-License-Identifier: AGPL-3.0-only
// Work with coding agents on the public page (PRD 29.3), and the journal that holds
// everything. The rule that matters: when building is off, a visitor's page is exactly
// what it would be if the person never used an agent. Not a section, not a streak day,
// not a square in the grid. And a highlight hidden from the page, or still a draft,
// never shows whatever the setting.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { scopeFor, type Scope } from "../../src/repos/context";
import { saveLinks, updateLink } from "../../src/repos/links";
import {
  ownerPagePreview,
  publicPageByHandle,
  savePublicProfile,
  shareLink,
  findPublicProfile,
  loadPublicDays,
  DAYS_PAGE_SIZE,
} from "../../src/repos/public-page";
import {
  listHighlights,
  pinHighlight,
  replaceDrafts,
  saveSignal,
  updateHighlight,
  localDay,
} from "../../src/repos/agent";
import { loadJournal } from "../../src/repos/journal";

let db: TestDb;
let scope: Scope;

const DAY_MS = 86_400_000;
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS);

beforeEach(async () => {
  db = await createTestDb();
  const owner = await createOwner({
    handle: db.handle,
    password: "a-good-password",
    displayName: "Abhay",
  });
  scope = scopeFor(db.handle, owner.id);

  // Reading: one link read and shared ten days ago.
  const saved = await saveLinks(scope, { text: "https://example.com/indexes", note: null });
  const id = saved.created[0]!.id;
  await updateLink(scope, id, { status: "read", readAt: daysAgo(10) });
  await shareLink(scope, id, "Indexes trade write speed for read speed.");

  // Building: sessions three and two days ago, with details.
  for (const [i, back] of [3, 2].entries()) {
    await saveSignal(scope, {
      sessionId: `s${i}`,
      tool: "claude-code",
      repo: "aeyhey",
      branch: "main",
      startedAt: new Date(daysAgo(back).getTime() - 3_600_000),
      endedAt: daysAgo(back),
      tokens: { input: 1000, output: 100, cache: 9000 },
      filesChanged: 4,
      details: {
        models: { "claude-opus-5-5": { input: 1000, output: 100, cache: 9000, messages: 5 } },
        linesAdded: 200,
        linesRemoved: 20,
        languages: { ts: 3 },
      },
    });
  }
  const pinned = await pinHighlight(scope, { text: "Shipped the journal", now: daysAgo(2) });
  const secret = await pinHighlight(scope, { text: "Client work for Acme", now: daysAgo(2) });
  await updateHighlight(scope, secret.id, { hiddenFromPage: true });
  await replaceDrafts(scope, localDay(daysAgo(3), "UTC"), [
    { text: "Drafted from a session", kind: "progress", repo: "aeyhey" },
    { text: "A line they removed", kind: "learned", repo: "aeyhey" },
  ]);
  const removed = (await listHighlights(scope, { from: localDay(daysAgo(3), "UTC") })).find(
    (h) => h.text === "A line they removed",
  )!;
  await updateHighlight(scope, removed.id, { status: "dropped" });
  expect(pinned.status).toBe("kept");

  await savePublicProfile(scope, { handle: "abhay", enabled: true });
});

afterEach(async () => {
  await db.cleanup();
});

async function page() {
  const result = await publicPageByHandle(db.handle, "abhay");
  expect(result).not.toBeNull();
  return result!;
}

describe("building off (the default)", () => {
  it("leaves the page exactly as if no agent was ever used", async () => {
    const visible = await page();
    expect(visible.building).toBeNull();
    // One day card, the reading day, with its learning and no Built section.
    expect(visible.days).toHaveLength(1);
    expect(visible.days[0]!.built).toBeNull();
    // Only reading counts: the day it was read and the day its takeaway was shared
    // (today). No streak day or grid square from the two agent days.
    expect(visible.stats!.daysActive).toBe(2);
    expect(visible.stats!.activity.counts.filter((n) => n > 0)).toHaveLength(2);
    const text = JSON.stringify(visible);
    for (const leak of ["Shipped the journal", "Acme", "draft", "claude", "aeyhey"]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

describe("numbers", () => {
  it("shows totals and counts the days, but no highlights, models or tokens", async () => {
    await savePublicProfile(scope, { buildingVisibility: "numbers" });
    const visible = await page();
    expect(visible.building).toMatchObject({
      daysBuilding: 2,
      sessions: 2,
      activeMinutes: 120,
      linesAdded: 400,
      languages: ["ts"],
      models: null,
      tokens: null,
    });
    // The two reading days plus the two agent days.
    expect(visible.stats!.daysActive).toBe(4);
    expect(JSON.stringify(visible)).not.toContain("Shipped the journal");
    // Day cards keep the Learned section; there is no Built section and no agent-only day.
    expect(visible.days.map((d) => d.built)).toEqual([null]);
    expect(visible.days[0]!.learned[0]!.text).toBe("Indexes trade write speed for read speed.");
  });
});

describe("numbers and highlights", () => {
  it("shows drafted and kept lines by themselves, never hidden or removed ones", async () => {
    await savePublicProfile(scope, { buildingVisibility: "highlights" });
    const visible = await page();
    // The agent day gets its own card with a Built section; the reading day keeps Learned.
    const built = visible.days.filter((d) => d.built);
    expect(built).toHaveLength(2);
    expect(built[0]!.built).toEqual({ done: ["Shipped the journal"], progress: [], learned: [] });
    expect(built[1]!.built).toEqual({
      done: [],
      progress: ["Drafted from a session"],
      learned: [],
    });
    expect(built[0]!.learned).toEqual([]);
    expect(visible.days.find((d) => d.learned.length > 0)!.built).toBeNull();
    const text = JSON.stringify(visible);
    expect(text).not.toContain("Acme");
    expect(text).not.toContain("A line they removed");
  });

  it("shows models and tokens only with their own switch", async () => {
    await savePublicProfile(scope, { buildingVisibility: "highlights", showAgentModels: true });
    const visible = await page();
    expect(visible.building!.models).toEqual([{ name: "claude-opus-5-5", share: 100 }]);
    expect(visible.building!.tokens).toBe(20_200);
  });
});

describe("the owner", () => {
  it("previews the same numbers a visitor gets", async () => {
    for (const visibility of ["off", "numbers"] as const) {
      await savePublicProfile(scope, { buildingVisibility: visibility });
      const profile = (await findPublicProfile(scope))!;
      const preview = await ownerPagePreview(scope, profile);
      const visible = await page();
      expect(preview.stats.daysActive).toBe(visible.stats!.daysActive);
      expect(preview.building).toEqual(visible.building);
    }
  });

  it("sees every day in the journal: reading, building and all highlights", async () => {
    const days = await loadJournal(scope, localDay(daysAgo(30), "UTC"));
    const reading = days.find((d) => d.read.length > 0)!;
    expect(reading.read[0]!.takeaway).toBe("Indexes trade write speed for read speed.");
    const building = days.filter((d) => d.building);
    expect(building).toHaveLength(2);
    expect(
      days
        .flatMap((d) => d.highlights)
        .map((h) => h.text)
        .sort(),
    ).toEqual(["Client work for Acme", "Drafted from a session", "Shipped the journal"]);
  });
});

describe("one activity", () => {
  it("adds building days to the same grid, weighted by time, only when visible", async () => {
    const total = (counts: number[]) => counts.reduce((sum, n) => sum + n, 0);
    const off = total((await page()).stats!.activity.counts);
    await savePublicProfile(scope, { buildingVisibility: "numbers" });
    const on = total((await page()).stats!.activity.counts);
    // Two agent days of an hour each: each counts like a couple of reads.
    expect(on - off).toBe(4);
  });
});

describe("the day feed loads in pages", () => {
  it("sends seven days at a time and pages back with before", async () => {
    await savePublicProfile(scope, { buildingVisibility: "highlights" });
    // Twelve more days of reading, from 20 to 31 days ago.
    for (let back = 20; back < 32; back++) {
      const saved = await saveLinks(scope, {
        text: `https://example.com/day-${back}`,
        note: null,
      });
      const id = saved.created[0]!.id;
      await updateLink(scope, id, { status: "read", readAt: daysAgo(back) });
      await shareLink(scope, id, `Lesson from ${back} days ago.`);
    }

    const first = await loadPublicDays(scope, { showBuilt: true });
    expect(first.days).toHaveLength(DAYS_PAGE_SIZE);
    expect(first.nextCursor).toBe(first.days.at(-1)!.day);

    const seen = first.days.map((d) => d.day);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await loadPublicDays(scope, { before: cursor, showBuilt: true });
      expect(next.days.length).toBeLessThanOrEqual(DAYS_PAGE_SIZE);
      for (const day of next.days) expect(day.day < cursor).toBe(true);
      seen.push(...next.days.map((d) => d.day));
      cursor = next.nextCursor;
    }
    // 12 + 1 reading days, plus the two agent days with lines: each once, newest first.
    expect(seen).toHaveLength(15);
    expect(new Set(seen).size).toBe(15);
    expect([...seen].sort().reverse()).toEqual(seen);

    // The page itself carries only the first page.
    const page = await publicPageByHandle(db.handle, "abhay");
    expect(page!.days).toHaveLength(DAYS_PAGE_SIZE);
    expect(page!.nextDaysCursor).toBe(first.nextCursor);
  });

  it("never pages in hidden or removed lines, or agent days when building is hidden", async () => {
    const all = [];
    for (const showBuilt of [true, false]) {
      let cursor: string | null = null;
      do {
        const next = await loadPublicDays(scope, { before: cursor ?? undefined, showBuilt });
        all.push({ showBuilt, days: next.days });
        cursor = next.nextCursor;
      } while (cursor);
    }
    const text = JSON.stringify(all);
    expect(text).not.toContain("Client work for Acme");
    expect(text).not.toContain("A line they removed");
    const hidden = all.filter((p) => !p.showBuilt).flatMap((p) => p.days);
    expect(hidden.every((d) => d.built === null)).toBe(true);
    expect(hidden.map((d) => d.day)).toEqual([localDay(daysAgo(10), "UTC")]);
  });

  it("ignores a cursor that is not a day", async () => {
    const page = await loadPublicDays(scope, { before: "x' or 1=1", showBuilt: false });
    expect(page.days).toHaveLength(1);
  });
});

describe("the owner's day feed", () => {
  it("carries link ids only when asked, so visitors never get them", async () => {
    const visitor = await loadPublicDays(scope, { showBuilt: false });
    const owner = await loadPublicDays(scope, { showBuilt: false, withIds: true });
    expect(visitor.days[0]!.learned[0]!.linkId).toBeUndefined();
    expect(owner.days[0]!.learned[0]!.linkId).toMatch(/\w+/);
    expect(owner.days.map((d) => d.day)).toEqual(visitor.days.map((d) => d.day));
  });
});
