// SPDX-License-Identifier: AGPL-3.0-only
// The stats page's numbers: an overdue card is due today, not lost off the chart.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { scopeFor, type Scope } from "../../src/repos/context";
import { loadStats } from "../../src/repos/stats";
import { newId } from "../../src/ids";

let db: TestDb;
let scope: Scope;

async function questionDue(due: Date): Promise<void> {
  const { decks, questions, cards } = db.handle.schema;
  const now = new Date();
  const deckId = newId();
  await db.handle.db
    .insert(decks)
    .values({ id: deckId, userId: scope.userId, name: "Optics", kind: "topics", createdAt: now });
  const questionId = newId();
  await db.handle.db.insert(questions).values({
    id: questionId,
    userId: scope.userId,
    deckId,
    position: 0,
    text: "What is refraction?",
    modelAnswer: "Light bending as it crosses into a medium of a different density.",
    keyPoints: [],
    category: "concept",
    difficulty: "easy",
    origin: "ai",
    reviewStatus: "kept",
    createdAt: now,
    updatedAt: now,
  });
  await db.handle.db.insert(cards).values({
    id: newId(),
    userId: scope.userId,
    itemType: "question",
    itemId: questionId,
    status: "active",
    due,
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  const owner = await createOwner({ handle: db.handle, displayName: "Test", timezone: "UTC" });
  scope = scopeFor(db.handle, owner.id);
});

afterEach(async () => {
  await db.cleanup();
});

describe("cards due", () => {
  it("counts overdue cards as due today", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    await questionDue(new Date("2026-11-10T09:00:00Z"));
    await questionDue(new Date("2026-11-15T18:00:00Z"));
    await questionDue(new Date("2026-11-17T09:00:00Z"));

    const stats = await loadStats(scope, now);
    expect(stats.duePerDay[0]).toEqual({ day: "2026-11-15", count: 2 });
    expect(stats.duePerDay[2]).toEqual({ day: "2026-11-17", count: 1 });
    expect(stats.duePerDay.reduce((sum, d) => sum + d.count, 0)).toBe(3);
  });
});
