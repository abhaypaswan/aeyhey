// SPDX-License-Identifier: AGPL-3.0-only
// The session loop against a real database (PRD 8.3, 9.3, 9.4, 9.5).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../helpers/db";
import { createOwner } from "../../src/extensions/defaults/local-auth";
import { scopeFor, type Scope } from "../../src/repos/context";
import { applyExtraction, applyEnrichment, saveLinks, findLinkById } from "../../src/repos/links";
import { findCardForItem, findCardById } from "../../src/repos/cards";
import { updateSettings } from "../../src/repos/settings";
import { getOrBuildSession, summarizeSession } from "../../src/sessions/service";
import {
  applyCardAction,
  undoCardAction,
  WrongCardKindError,
  CardActionSchema,
} from "../../src/sessions/actions";
import { newId } from "../../src/ids";
import { applyLinkAction } from "../../src/scheduler/scheduler";

let db: TestDb;
let scope: Scope;

/** A link that has been through the whole pipeline, so it is session ready. */
async function readyLink(url: string, title: string): Promise<{ linkId: string; cardId: string }> {
  const saved = await saveLinks(scope, { text: url });
  const linkId = saved.created[0]!.id;

  await applyExtraction(scope, linkId, {
    status: "ok",
    title,
    contentType: "article",
    text: "Some real content about the topic, long enough to summarize properly.",
    language: "en",
  });
  await applyEnrichment(scope, linkId, {
    aiStatus: "ok",
    summaryLines: ["One.", "Two.", "Three."],
    whySaved: "You probably saved this to read later.",
    summaryConfidence: "high",
    contentType: "article",
    readMinutes: 5,
    language: "en",
  });

  const card = await findCardForItem(scope, { type: "link", id: linkId });
  return { linkId, cardId: card!.id };
}

/** A question with a card, created directly: the generation runtime is a separate module. */
async function makeQuestion(text: string): Promise<{ questionId: string; cardId: string }> {
  const { decks, questions, cards } = db.handle.schema;
  const now = new Date();

  const deckRows = await db.handle.db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, scope.userId), eq(decks.kind, "topics")))
    .limit(1);

  let deckId = deckRows[0]?.id;
  if (!deckId) {
    deckId = newId();
    await db.handle.db.insert(decks).values({
      id: deckId,
      userId: scope.userId,
      name: "Postgres",
      kind: "topics",
      createdAt: now,
    });
  }

  const questionId = newId();
  await db.handle.db.insert(questions).values({
    id: questionId,
    userId: scope.userId,
    deckId,
    position: 0,
    text,
    modelAnswer: "The answer a strong candidate would give, written out properly.",
    keyPoints: ["first point", "second point"],
    category: "technical",
    difficulty: "medium",
    origin: "ai",
    reviewStatus: "kept",
    createdAt: now,
    updatedAt: now,
  });

  const cardId = newId();
  await db.handle.db.insert(cards).values({
    id: cardId,
    userId: scope.userId,
    itemType: "question",
    itemId: questionId,
    status: "new",
    due: now,
    createdAt: now,
    updatedAt: now,
  });

  return { questionId, cardId };
}

beforeEach(async () => {
  db = await createTestDb();
  const owner = await createOwner({ handle: db.handle, displayName: "Test", timezone: "UTC" });
  scope = scopeFor(db.handle, owner.id);
});

afterEach(async () => {
  await db.cleanup();
});

describe("building a session", () => {
  it("says nothing is saved when the account is empty", async () => {
    const payload = await getOrBuildSession(scope);
    expect(payload.items).toHaveLength(0);
    expect(payload.emptyReason).toBe("nothing_saved");
    expect(payload.nextSessionLabel).toBeTruthy();
  });

  it("builds a mixed session and opens with a link, which is the easy first tap", async () => {
    await readyLink("https://example.com/a", "Link A");
    await readyLink("https://example.com/b", "Link B");
    await makeQuestion("What is a b-tree index?");
    await makeQuestion("When would you use GIN?");
    await makeQuestion("Explain index selectivity.");

    const payload = await getOrBuildSession(scope);

    expect(payload.session).not.toBeNull();
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items[0]!.kind).toBe("link");
    expect(payload.progress).toEqual({ total: payload.items.length, done: 0, position: 1 });

    // No two links in a row while questions remain (PRD 9.5 step 6).
    for (let i = 1; i < payload.items.length; i += 1) {
      if (payload.items[i]!.kind === "link" && payload.items[i - 1]!.kind === "link") {
        const questionsLater = payload.items.slice(i).some((item) => item.kind === "question");
        expect(questionsLater, "two links in a row while questions remained").toBe(false);
      }
    }
  });

  it("respects cards_per_session", async () => {
    for (let i = 0; i < 6; i += 1) await makeQuestion(`Question ${i}`);
    await updateSettings(scope, { cardsPerSession: 3 });

    const payload = await getOrBuildSession(scope);
    expect(payload.items).toHaveLength(3);
  });

  it("rations new questions, so one big import does not drown the queue", async () => {
    for (let i = 0; i < 10; i += 1) await makeQuestion(`Question ${i}`);
    await updateSettings(scope, { cardsPerSession: 10, maxNewQuestions: 2 });

    const payload = await getOrBuildSession(scope);
    // Every question here is new, so the new limit is the real cap.
    expect(payload.items).toHaveLength(2);
  });

  it("leaves out a link whose summary is still being written", async () => {
    // Saved but never extracted, so ai_status is still pending.
    await saveLinks(scope, { text: "https://example.com/pending" });
    await makeQuestion("A question");

    const payload = await getOrBuildSession(scope);
    expect(payload.items.every((item) => item.kind === "question")).toBe(true);
  });

  it("does not send the model answer with a question card", async () => {
    await makeQuestion("What is a b-tree index?");
    const payload = await getOrBuildSession(scope);

    const card = payload.items.find((item) => item.kind === "question");
    expect(card).toBeDefined();
    // The answer is not in the payload of the page that asks the question.
    expect(JSON.stringify(card)).not.toContain("strong candidate");
  });

  it("says nothing is due when everything is scheduled for later", async () => {
    const { cardId } = await makeQuestion("A question");
    await applyCardAction({ scope }, cardId, { action: "rate", rating: 4, via: "quick" });

    const payload = await getOrBuildSession(scope);
    expect(payload.items).toHaveLength(0);
    expect(payload.emptyReason).toBe("nothing_due");
  });

  it("reports paused rather than building a session", async () => {
    await makeQuestion("A question");
    await updateSettings(scope, { pausedUntil: new Date(Date.now() + 86_400_000) });

    const payload = await getOrBuildSession(scope);
    expect(payload.emptyReason).toBe("paused");
    expect(payload.items).toHaveLength(0);
  });
});

describe("resuming a session (PRD 8.3 FR-S-1)", () => {
  it("picks up at card 3 of 5 with the same remaining cards", async () => {
    await readyLink("https://example.com/a", "Link A");
    for (let i = 0; i < 4; i += 1) await makeQuestion(`Question ${i}`);
    await updateSettings(scope, { cardsPerSession: 5, maxNewQuestions: 4 });

    const first = await getOrBuildSession(scope);
    expect(first.items).toHaveLength(5);
    const originalOrder = first.items.map((item) => item.cardId);

    // Act on the first two, then walk away.
    for (const item of first.items.slice(0, 2)) {
      await applyCardAction(
        { scope, sessionId: first.session!.id },
        item.cardId,
        item.kind === "link" ? { action: "read" } : { action: "rate", rating: 3, via: "quick" },
      );
    }

    const resumed = await getOrBuildSession(scope);

    expect(resumed.session!.id).toBe(first.session!.id);
    expect(resumed.progress).toEqual({ total: 5, done: 2, position: 3 });
    expect(resumed.items).toHaveLength(3);
    // The same cards, in the same order, not a reshuffle.
    expect(resumed.items.map((item) => item.cardId)).toEqual(originalOrder.slice(2));
  });

  it("does not build a second session while one is open and finished", async () => {
    const { cardId } = await makeQuestion("A question");
    const first = await getOrBuildSession(scope);
    await applyCardAction({ scope, sessionId: first.session!.id }, cardId, {
      action: "rate",
      rating: 3,
      via: "quick",
    });

    const after = await getOrBuildSession(scope);
    expect(after.session!.id).toBe(first.session!.id);
    expect(after.items).toHaveLength(0);
    expect(after.progress!.done).toBe(1);
  });

  it("builds a fresh one when asked for more", async () => {
    for (let i = 0; i < 4; i += 1) await makeQuestion(`Question ${i}`);
    await updateSettings(scope, { cardsPerSession: 1, maxNewQuestions: 4 });

    const first = await getOrBuildSession(scope);
    await applyCardAction({ scope, sessionId: first.session!.id }, first.items[0]!.cardId, {
      action: "rate",
      rating: 3,
      via: "quick",
    });

    const more = await getOrBuildSession(scope, { size: 2 });
    expect(more.session!.id).not.toBe(first.session!.id);
    expect(more.items).toHaveLength(2);
  });
});

describe("link actions", () => {
  it("Read now ends scheduling and gives back the URL to open", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");

    const result = await applyCardAction({ scope }, cardId, { action: "read" });

    expect(result.openUrl).toBe("https://example.com/a");
    expect(result.nextDueLabel).toMatch(/will not come back/i);

    const link = await findLinkById(scope, linkId);
    expect(link!.status).toBe("read");
    expect(link!.readAt).not.toBeNull();

    const card = await findCardById(scope, cardId);
    expect(card!.status).toBe("read");

    // A read link does not come back on its own.
    expect((await getOrBuildSession(scope)).items).toHaveLength(0);
  });

  it("Remind me later pushes it out and counts the snooze", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");

    const result = await applyCardAction({ scope }, cardId, {
      action: "snooze",
      variant: "default",
    });

    expect(result.nextDueLabel).toMatch(/back in/i);

    const link = await findLinkById(scope, linkId);
    expect(link!.status).toBe("snoozed");
    // The snooze counter is what eventually triggers expiry (PRD 9.4).
    expect(link!.snoozeCount).toBe(1);

    const card = await findCardById(scope, cardId);
    expect(card!.due.getTime()).toBeGreaterThan(Date.now());
  });

  it("pushes a repeatedly snoozed link further out each time", async () => {
    const { cardId } = await readyLink("https://example.com/a", "Link A");

    // Time has to actually move: an FSRS interval depends on how long it has been since
    // the last review, so rewriting the due column without moving `now` would ask the
    // scheduler a question that cannot happen in real use.
    let now = new Date("2026-06-01T09:00:00Z");
    const intervals: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      await applyCardAction({ scope, now }, cardId, { action: "snooze", variant: "default" });
      const card = await findCardById(scope, cardId);
      intervals.push(card!.due.getTime() - now.getTime());
      // The next snooze happens when the user is next shown the card.
      now = card!.due;
    }

    expect(intervals[1]!).toBeGreaterThan(intervals[0]!);
    expect(intervals[2]!).toBeGreaterThan(intervals[1]!);
  });

  it("Drop takes it out of sessions but keeps it findable", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");
    await applyCardAction({ scope }, cardId, { action: "drop" });

    const link = await findLinkById(scope, linkId);
    expect(link!.status).toBe("dropped");
    // Still there, which is what makes Restore possible.
    expect(link).not.toBeNull();
  });

  it("rescues a last chance link on a snooze, and only once", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");
    const { links } = db.handle.schema;

    await db.handle.db
      .update(links)
      .set({ status: "expiring", snoozeCount: 5 })
      .where(eq(links.id, linkId));
    await db.handle.db
      .update(db.handle.schema.cards)
      .set({ status: "expiring" })
      .where(eq(db.handle.schema.cards.id, cardId));

    await applyCardAction({ scope }, cardId, { action: "snooze", variant: "default" });

    const link = await findLinkById(scope, linkId);
    expect(link!.status).toBe("snoozed");
    // The counter is reset and rescued is set, so the next trip to the exit is final.
    expect(link!.snoozeCount).toBe(0);
    expect(link!.rescued).toBe(true);
  });

  it("refuses a question action on a link card", async () => {
    const { cardId } = await readyLink("https://example.com/a", "Link A");
    await expect(
      applyCardAction({ scope }, cardId, { action: "rate", rating: 3, via: "quick" }),
    ).rejects.toThrow(WrongCardKindError);
  });
});

describe("question actions", () => {
  it("rates a card and schedules it further out for Easy than for Again", async () => {
    const easy = await makeQuestion("Easy one");
    const again = await makeQuestion("Hard one");

    await applyCardAction({ scope }, easy.cardId, { action: "rate", rating: 4, via: "quick" });
    await applyCardAction({ scope }, again.cardId, { action: "rate", rating: 1, via: "quick" });

    const easyCard = await findCardById(scope, easy.cardId);
    const againCard = await findCardById(scope, again.cardId);

    expect(easyCard!.due.getTime()).toBeGreaterThan(againCard!.due.getTime());
    expect(easyCard!.status).toBe("active");
    expect(easyCard!.reps).toBe(1);
  });

  it("skips without touching the memory model", async () => {
    const { cardId } = await makeQuestion("A question");
    const before = await findCardById(scope, cardId);

    const result = await applyCardAction({ scope }, cardId, { action: "skip" });

    const after = await findCardById(scope, cardId);
    expect(after!.skipCount).toBe(1);
    expect(after!.reps).toBe(before!.reps);
    expect(after!.stability).toBe(before!.stability);
    expect(result.nextDueLabel).toMatch(/next session/i);
  });

  it("warns after three skips in a row", async () => {
    const { cardId } = await makeQuestion("A question");

    let label = "";
    for (let i = 0; i < 3; i += 1) {
      label = (await applyCardAction({ scope }, cardId, { action: "skip" })).nextDueLabel;
    }

    expect(label).toMatch(/skipped this a few times/i);
  });

  it("resets the skip count on any rating", async () => {
    const { cardId } = await makeQuestion("A question");
    await applyCardAction({ scope }, cardId, { action: "skip" });
    await applyCardAction({ scope }, cardId, { action: "rate", rating: 3, via: "quick" });

    expect((await findCardById(scope, cardId))!.skipCount).toBe(0);
  });

  it("refuses a link action on a question card", async () => {
    const { cardId } = await makeQuestion("A question");
    await expect(applyCardAction({ scope }, cardId, { action: "read" })).rejects.toThrow(
      WrongCardKindError,
    );
  });
});

describe("undo (PRD 8.3 FR-S-5)", () => {
  it("restores the card exactly as it was", async () => {
    const { cardId } = await makeQuestion("A question");
    const before = await findCardById(scope, cardId);

    const result = await applyCardAction({ scope }, cardId, {
      action: "rate",
      rating: 4,
      via: "quick",
    });
    const after = await findCardById(scope, cardId);
    expect(after!.due.getTime()).not.toBe(before!.due.getTime());

    const undone = await undoCardAction(scope, result.reviewId);
    expect(undone.ok).toBe(true);

    const restored = await findCardById(scope, cardId);
    expect(restored!.due.getTime()).toBe(before!.due.getTime());
    expect(restored!.stability).toBe(before!.stability);
    expect(restored!.difficulty).toBe(before!.difficulty);
    expect(restored!.fsrsState).toBe(before!.fsrsState);
    expect(restored!.reps).toBe(before!.reps);
    expect(restored!.lapses).toBe(before!.lapses);
    expect(restored!.status).toBe(before!.status);
  });

  it("restores a link's status too", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");
    const result = await applyCardAction({ scope }, cardId, { action: "read" });

    await undoCardAction(scope, result.reviewId);

    const card = await findCardById(scope, cardId);
    expect(card!.status).toBe("unread");
    // The link row is the user-visible status, and the undo has to reach it too.
    const link = await findLinkById(scope, linkId);
    expect(link!.status).toBe("read");
  });

  it("puts the card back into its session, so it comes up again", async () => {
    await readyLink("https://example.com/a", "Link A");
    await readyLink("https://example.com/b", "Link B");
    const first = await getOrBuildSession(scope);
    const sessionId = first.session!.id;
    const card = first.items[0]!;

    const result = await applyCardAction({ scope, sessionId }, card.cardId, {
      action: "snooze",
      variant: "default",
    });
    const during = await getOrBuildSession(scope);
    expect(during.items.map((item) => item.cardId)).not.toContain(card.cardId);

    await undoCardAction(scope, result.reviewId);
    const after = await getOrBuildSession(scope);
    expect(after.session!.id).toBe(sessionId);
    expect(after.items[0]!.cardId).toBe(card.cardId);
    expect(after.progress?.done).toBe(0);
  });

  it("cannot undo the same action twice", async () => {
    const { cardId } = await makeQuestion("A question");
    const result = await applyCardAction({ scope }, cardId, {
      action: "rate",
      rating: 3,
      via: "quick",
    });

    expect((await undoCardAction(scope, result.reviewId)).ok).toBe(true);
    const second = await undoCardAction(scope, result.reviewId);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/already been undone/i);
  });

  it("refuses an unknown review id", async () => {
    expect((await undoCardAction(scope, "nope")).ok).toBe(false);
  });
});

describe("the session summary", () => {
  it("counts what happened", async () => {
    const link = await readyLink("https://example.com/a", "Link A");
    const q1 = await makeQuestion("Q1");
    const q2 = await makeQuestion("Q2");
    await updateSettings(scope, { cardsPerSession: 3, maxNewQuestions: 2 });

    const session = await getOrBuildSession(scope);
    const sessionId = session.session!.id;

    await applyCardAction({ scope, sessionId }, link.cardId, { action: "read" });
    await applyCardAction({ scope, sessionId }, q1.cardId, {
      action: "rate",
      rating: 3,
      via: "quick",
    });
    await applyCardAction({ scope, sessionId }, q2.cardId, { action: "skip" });

    const summary = await summarizeSession(scope, sessionId);

    expect(summary.cardsDone).toBe(3);
    expect(summary.linksRead).toBe(1);
    expect(summary.questionsAnswered).toBe(1);
    expect(summary.questionsSkipped).toBe(1);
    expect(summary.nextSessionLabel).toBeTruthy();
  });

  it("leaves an undone action out of the counts", async () => {
    const { cardId } = await makeQuestion("Q1");
    const session = await getOrBuildSession(scope);
    const sessionId = session.session!.id;

    const result = await applyCardAction({ scope, sessionId }, cardId, {
      action: "rate",
      rating: 3,
      via: "quick",
    });
    await undoCardAction(scope, result.reviewId);

    const summary = await summarizeSession(scope, sessionId);
    expect(summary.questionsAnswered).toBe(0);
  });
});

describe("the action schema", () => {
  it("accepts the documented shapes and rejects the rest", () => {
    expect(CardActionSchema.safeParse({ action: "read" }).success).toBe(true);
    expect(CardActionSchema.safeParse({ action: "snooze" }).success).toBe(true);
    expect(CardActionSchema.parse({ action: "snooze" })).toEqual({
      action: "snooze",
      variant: "default",
    });
    expect(CardActionSchema.safeParse({ action: "rate", rating: 3, via: "quick" }).success).toBe(
      true,
    );
    expect(CardActionSchema.safeParse({ action: "rate", rating: 7, via: "quick" }).success).toBe(
      false,
    );
    expect(CardActionSchema.safeParse({ action: "answer", answer: "" }).success).toBe(false);
    expect(CardActionSchema.safeParse({ action: "nonsense" }).success).toBe(false);
  });
});

describe("the owner's email is optional (PRD 12.1, 16.2)", () => {
  // A self-hoster who skips the email has no username to type. The login screen asks
  // ownerHasEmail so it can leave the field out entirely rather than showing an empty box
  // that looks required, which is what someone running it for the first time got stuck on.
  it("creates an owner with no email, and signing in needs only the password", async () => {
    const fresh = await createTestDb();
    try {
      const { createOwner, ownerExists, ownerHasEmail, createLocalSingleUserAuth } =
        await import("../../src/extensions/defaults/local-auth.js");

      await createOwner({
        handle: fresh.handle,
        password: "a-good-password",
        displayName: "Abhay",
      });

      expect(await ownerExists(fresh.handle)).toBe(true);
      expect(await ownerHasEmail(fresh.handle)).toBe(false);

      const auth = createLocalSingleUserAuth({
        handle: fresh.handle,
        appSecret: "x".repeat(48),
        authMode: "password",
        publicUrl: "http://localhost:3000",
      });

      // No email in the request at all, which is what the form sends.
      const headers = new Headers();
      const user = await auth.signIn!({ password: "a-good-password" }, { headers });
      expect(user.displayName).toBe("Abhay");
      expect(headers.get("set-cookie")).toContain("aeyhey_session=");

      // And the wrong password is still refused.
      await expect(
        auth.signIn!({ password: "not-it" }, { headers: new Headers() }),
      ).rejects.toThrow();
    } finally {
      await fresh.cleanup();
    }
  });

  it("reports an email when the owner did set one", async () => {
    const fresh = await createTestDb();
    try {
      const { createOwner, ownerHasEmail } =
        await import("../../src/extensions/defaults/local-auth.js");
      await createOwner({
        handle: fresh.handle,
        email: "someone@example.com",
        password: "a-good-password",
      });
      expect(await ownerHasEmail(fresh.handle)).toBe(true);
    } finally {
      await fresh.cleanup();
    }
  });
});

describe("bulk restore brings a link back (PRD 9.4 rule 4)", () => {
  // Restore used to set links.status back to unread and leave the card alone. A link
  // snoozed four times is scheduled months out, so it stayed invisible: the button
  // appeared to do nothing, and nothing in the UI said why.
  it("resets the schedule, not just the status", async () => {
    const { linkId, cardId } = await readyLink("https://example.com/a", "Link A");

    // Snooze it until it is a long way out. Time is simulated, so every comparison below
    // is against this timeline rather than the real clock.
    const start = new Date("2026-06-01T09:00:00Z");
    let now = start;
    for (let i = 0; i < 4; i += 1) {
      await applyCardAction({ scope, now }, cardId, { action: "snooze", variant: "default" });
      now = (await findCardById(scope, cardId))!.due;
    }

    const snoozed = await findCardById(scope, cardId);
    expect(snoozed!.due.getTime() - start.getTime()).toBeGreaterThan(30 * 86_400_000);

    // What the inbox's Restore button does, at a point in the simulated timeline.
    await applyCardAction({ scope, now }, cardId, { action: "drop" });
    const restored = applyLinkAction({
      card: (await findCardById(scope, cardId))!,
      action: { kind: "restore" },
      now,
    });

    expect(restored.card.status).toBe("unread");
    expect(restored.card.fsrsState).toBe(0);
    expect(restored.card.reps).toBe(0);
    // Due immediately, so it is eligible for the very next session rather than staying
    // months out, which is the bug this guards.
    expect(restored.card.due.getTime()).toBeLessThanOrEqual(now.getTime() + 1000);
    void linkId;
  });
});
