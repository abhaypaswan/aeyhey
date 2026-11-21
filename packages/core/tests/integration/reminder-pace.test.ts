// SPDX-License-Identifier: AGPL-3.0-only
// The reminder loop eases off for someone who stops coming back, and picks up again
// when they return.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { newId } from "../../src/ids";
import { markSeen } from "../../src/repos/activity";
import { runReminderLoop } from "../../src/notify/reminder-loop";
import type { DeliveryPayload, NotificationChannel } from "../../src/notify/types";

const DAY = 24 * 60 * 60 * 1000;
// Daily at 09:00 UTC; the loop runs at 10:00 on each simulated day.
const start = new Date("2030-01-01T10:00:00Z");
const day = (n: number) => new Date(start.getTime() + n * DAY);

let db: TestDb;
let userId: string;
let sent: { day: number; payload: DeliveryPayload }[];
let today = 0;

const channel: NotificationChannel = {
  id: "push",
  isConfigured: () => true,
  isEnabledFor: async () => true,
  deliver: async (payload) => {
    sent.push({ day: today, payload });
    return { ok: true };
  },
  sendTest: async () => ({ ok: true }),
};

async function runDays(from: number, to: number): Promise<void> {
  for (today = from; today <= to; today += 1) {
    await runReminderLoop({
      handle: db.handle,
      channels: [channel],
      publicUrl: "http://localhost:3000",
      now: day(today),
    });
  }
}

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  const owner = await createOwner({ handle: db.handle, displayName: "Test", timezone: "UTC" });
  userId = owner.id;
  const { users, decks, questions, cards } = db.handle.schema;
  // Signed up the day before, and never back.
  await db.handle.db
    .update(users)
    .set({ createdAt: day(-1) })
    .where(eq(users.id, userId));

  const deckId = newId();
  const now = new Date();
  await db.handle.db
    .insert(decks)
    .values({ id: deckId, userId, name: "Postgres", kind: "topics", createdAt: now });
  for (let i = 0; i < 3; i += 1) {
    const questionId = newId();
    await db.handle.db.insert(questions).values({
      id: questionId,
      userId,
      deckId,
      position: i,
      text: `Question ${i}?`,
      modelAnswer: "An answer.",
      keyPoints: ["a point"],
      category: "technical",
      difficulty: "medium",
      origin: "ai",
      reviewStatus: "kept",
      createdAt: now,
      updatedAt: now,
    });
    await db.handle.db.insert(cards).values({
      id: newId(),
      userId,
      itemType: "question",
      itemId: questionId,
      status: "new",
      due: now,
      createdAt: now,
      updatedAt: now,
    });
  }
});

afterEach(async () => {
  await db.cleanup();
});

describe("reminders for someone who has gone quiet", () => {
  it("sends five daily, then weekly, says the last one is the last, then stops", async () => {
    await runDays(0, 60);
    expect(sent.map((s) => s.day)).toEqual([0, 1, 2, 3, 4, 11, 18, 25, 32]);
    expect(sent.map((s) => s.payload.pace ?? "normal")).toEqual([
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "weekly",
      "weekly",
      "weekly",
      "last",
    ]);
  });

  it("goes back to daily once they come back", async () => {
    await runDays(0, 40);
    await markSeen(db.handle, userId, new Date(day(41).getTime() - 30 * 60 * 1000));
    sent = [];
    await runDays(41, 43);
    expect(sent.map((s) => s.day)).toEqual([41, 42, 43]);
    expect(sent.every((s) => s.payload.pace === undefined)).toBe(true);
  });
});
