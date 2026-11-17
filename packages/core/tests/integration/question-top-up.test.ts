// SPDX-License-Identifier: AGPL-3.0-only
// Questions written by Aeyhey on a schedule: kept straight in, topped up before each
// reminder to settings.maxNewQuestions, never twice for one slot, and never repeating a
// question the user removed. Plus the deck endpoints that show and edit topic details.
// Through the real handlers, the real worker and the mock AI.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { loadEnv } from "../../src/env";
import { buildRegistry } from "../../src/extensions/registry";
import { createLocalSingleUserAuth, createOwner } from "../../src/extensions/defaults/local-auth";
import { createEnvAndUserKeyProvider } from "../../src/extensions/defaults/env-user-keys";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { createApi, type Api } from "../../src/api/handlers";
import { createWorker } from "../../src/jobs/worker";
import { scopeFor } from "../../src/repos/context";
import { updateSettings } from "../../src/repos/settings";
import { existingQuestionTexts, saveGrade, unseenQuestionsByDeck } from "../../src/repos/questions";
import { queueTopUps, TOP_UP_JOB, TOP_UP_LEAD_MS } from "../../src/questions/top-up";
import { dueCounts, loadSessionCandidates } from "../../src/repos/cards";

const BASE = "http://localhost:3000";
const SECRET = "t".repeat(48);

let db: TestDb;
let dataDir: string;
let api: Api;
let ownerId: string;
let run: () => Promise<void>;

function send(method: string, path: string, body?: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

type DeckBody = {
  deck: { id: string; name: string; kind: string; counts: { total: number; new: number } };
  topics: { name: string; details: string | null }[];
};
type ErrorBody = { error: { code: string; fields?: Record<string, string[]> } };

/** Creates a topics deck through the API and runs its first generation. */
async function topicsDeck(topics: string[], countPerTopic = 2): Promise<string> {
  const res = await api.createTopicSource(
    send("POST", "/api/question-sources/topics", { topics, countPerTopic }),
  );
  expect(res.status).toBe(201);
  await run();
  const decks = (await (await api.listDecks(send("GET", "/api/decks"))).json()) as {
    decks: { id: string; name: string }[];
  };
  return decks.decks[decks.decks.length - 1]!.id;
}

async function topUpJobs() {
  const { jobs } = db.handle.schema;
  return db.handle.db.select().from(jobs).where(eq(jobs.type, TOP_UP_JOB));
}

/** Marks every new question card as seen, as if the user did their sessions. */
async function seeAllQuestions() {
  const { cards } = db.handle.schema;
  await db.handle.db
    .update(cards)
    .set({ status: "active", reps: 1 })
    .where(and(eq(cards.itemType, "question"), eq(cards.status, "new")));
}

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-topup-"));
  const owner = await createOwner({ handle: db.handle, password: "a-good-password" });
  ownerId = owner.id;
  const env = loadEnv({
    DATA_DIR: dataDir,
    PUBLIC_URL: BASE,
    APP_SECRET: SECRET,
    AI_PROVIDER: "mock",
  });
  const registry = buildRegistry({
    defaults: {
      auth: createLocalSingleUserAuth({
        handle: db.handle,
        appSecret: SECRET,
        authMode: "none",
        publicUrl: BASE,
      }),
      aiKeys: createEnvAndUserKeyProvider({ handle: db.handle, env, appSecret: SECRET }),
      usageGate: createAllowAllGate(),
      usageSink: createLocalUsageSink(db.handle),
    },
  });
  api = createApi({ handle: db.handle, env, registry, appSecret: SECRET });
  run = () =>
    createWorker({
      handle: db.handle,
      env,
      registry,
      appSecret: SECRET,
      maxPolls: 4,
      pollIntervalMs: 1,
      periodicWork: false,
    }).run();
});

afterEach(async () => {
  await db.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the first batch", () => {
  it("goes straight in as kept with cards, with nothing left to review", async () => {
    const deckId = await topicsDeck(["Physics"], 3);
    const scope = scopeFor(db.handle, ownerId);
    expect((await unseenQuestionsByDeck(scope)).get(deckId)).toBe(3);

    const deck = (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
      questions: { reviewStatus: string }[];
    };
    expect(deck.questions).toHaveLength(3);
    expect(deck.questions.every((q) => q.reviewStatus === "kept")).toBe(true);
  });
});

describe("queueing the top-up", () => {
  it("queues once per user and slot, inside the lead window only, even after it ran", async () => {
    const scope = scopeFor(db.handle, ownerId);
    await updateSettings(scope, { cadence: "daily", sendTime: "09:00", timezone: "UTC" });

    // An hour before the slot: too early.
    expect(await queueTopUps({ handle: db.handle, now: new Date("2026-11-16T08:00:00Z") })).toEqual(
      [],
    );

    const inWindow = new Date(Date.parse("2026-11-16T09:00:00Z") - TOP_UP_LEAD_MS + 60_000);
    expect(await queueTopUps({ handle: db.handle, now: inWindow })).toEqual([ownerId]);
    // A restart a minute later finds the job and queues nothing.
    const later = new Date(inWindow.getTime() + 60_000);
    expect(await queueTopUps({ handle: db.handle, now: later })).toEqual([]);

    // Still nothing once the job has finished.
    await run();
    expect((await topUpJobs()).every((job) => job.status === "done")).toBe(true);
    expect(await queueTopUps({ handle: db.handle, now: later })).toEqual([]);
    expect(await topUpJobs()).toHaveLength(1);

    // The next day's slot gets its own.
    const nextDay = new Date(inWindow.getTime() + 24 * 60 * 60 * 1000);
    expect(await queueTopUps({ handle: db.handle, now: nextDay })).toEqual([ownerId]);
  });

  it("skips a paused user", async () => {
    const scope = scopeFor(db.handle, ownerId);
    await updateSettings(scope, {
      cadence: "daily",
      sendTime: "09:00",
      timezone: "UTC",
      pausedUntil: new Date("2026-12-01T00:00:00Z"),
    });
    const inWindow = new Date(Date.parse("2026-11-16T09:00:00Z") - 60_000);
    expect(await queueTopUps({ handle: db.handle, now: inWindow })).toEqual([]);
  });
});

describe("running the top-up", () => {
  async function runTopUp() {
    const scope = scopeFor(db.handle, ownerId);
    await updateSettings(scope, { cadence: "daily", sendTime: "09:00", timezone: "UTC" });
    await queueTopUps({ handle: db.handle, now: new Date("2026-11-16T08:50:00Z") });
    await run();
  }

  it("writes only the shortfall, and only for decks whose questions have all been asked", async () => {
    const scope = scopeFor(db.handle, ownerId);
    const physics = await topicsDeck(["Physics"], 1);
    await seeAllQuestions();
    const history = await topicsDeck(["History"], 1);
    // Physics has 0 unseen, History 1. Target 4: shortfall 3, all to Physics, since
    // History still has a question the user has not been asked.
    await updateSettings(scope, { maxNewQuestions: 4 });

    await runTopUp();
    const unseen = await unseenQuestionsByDeck(scope);
    expect(unseen.get(physics)).toBe(3);
    expect(unseen.get(history)).toBe(1);
  });

  it("writes nothing when the user already has enough unseen", async () => {
    const scope = scopeFor(db.handle, ownerId);
    const deck = await topicsDeck(["Physics"], 3);
    await updateSettings(scope, { maxNewQuestions: 3 });
    await runTopUp();
    expect((await unseenQuestionsByDeck(scope)).get(deck)).toBe(3);
  });

  it("never writes a removed question again", async () => {
    const scope = scopeFor(db.handle, ownerId);
    const deckId = await topicsDeck(["Physics"], 1);
    const deck = (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
      questions: { id: string; text: string }[];
    };
    const removed = deck.questions[0]!;
    const res = await api.deleteQuestion(removed.id)(
      send("DELETE", `/api/questions/${removed.id}`),
    );
    expect(res.status).toBe(200);

    // Gone from the deck and its card is gone, but its text is still avoided.
    const after = (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
      questions: unknown[];
    };
    expect(after.questions).toHaveLength(0);
    expect(await existingQuestionTexts(scope, { deckId })).toContain(removed.text);

    await updateSettings(scope, { maxNewQuestions: 2 });
    await runTopUp();
    const texts = (
      (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
        questions: { text: string }[];
      }
    ).questions.map((q) => q.text);
    expect(texts).toHaveLength(2);
    expect(texts).not.toContain(removed.text);
  });
});

describe("deck topics and details", () => {
  it("shows topics and when the next questions come on GET /decks/{id}", async () => {
    const scope = scopeFor(db.handle, ownerId);
    await updateSettings(scope, { cadence: "daily", sendTime: "09:00", timezone: "UTC" });
    const deckId = await topicsDeck(["Physics", "Chemistry"], 1);
    const body = (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
      topics: unknown;
      nextQuestionsLabel: string | null;
    };
    expect(body.topics).toEqual([
      { name: "Physics", details: null },
      { name: "Chemistry", details: null },
    ]);
    expect(body.nextQuestionsLabel).toMatch(/at 09:00$/);

    await updateSettings(scope, { pausedUntil: new Date(Date.now() + 86_400_000) });
    const paused = (await (await api.getDeck(deckId)(send("GET", "/x"))).json()) as {
      nextQuestionsLabel: string | null;
    };
    expect(paused.nextQuestionsLabel).toBeNull();
  });

  it("sets, trims and clears details, leaving other topics alone", async () => {
    const deckId = await topicsDeck(["Physics", "Chemistry"], 1);
    const patch = (body: unknown) =>
      api.renameDeck(deckId)(send("PATCH", `/api/decks/${deckId}`, body));

    const set = await patch({ topicDetails: { Physics: "  Class 11 CBSE, chapters 1 to 5  " } });
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as DeckBody;
    expect(setBody.deck.id).toBe(deckId);
    expect(setBody.topics).toEqual([
      { name: "Physics", details: "Class 11 CBSE, chapters 1 to 5" },
      { name: "Chemistry", details: null },
    ]);

    // Other topics are left alone; an empty string clears one.
    await patch({ topicDetails: { Chemistry: "Organic only" } });
    const cleared = (await (await patch({ topicDetails: { Physics: "" } })).json()) as DeckBody;
    expect(cleared.topics).toEqual([
      { name: "Physics", details: null },
      { name: "Chemistry", details: "Organic only" },
    ]);
  });

  it("renames and sets details in one call", async () => {
    const deckId = await topicsDeck(["Physics"], 1);
    const res = await api.renameDeck(deckId)(
      send("PATCH", `/api/decks/${deckId}`, {
        name: "Physics 11",
        topicDetails: { Physics: "Optics" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeckBody;
    expect(body.deck.name).toBe("Physics 11");
    expect(body.topics[0]!.details).toBe("Optics");
  });

  it("refuses an unknown topic, details over 500 characters, and an empty body", async () => {
    const deckId = await topicsDeck(["Physics"], 1);
    const patch = (body: unknown) =>
      api.renameDeck(deckId)(send("PATCH", `/api/decks/${deckId}`, body));

    const unknown = await patch({ topicDetails: { Biology: "cells" } });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as ErrorBody).error.code).toBe("unknown_topic");

    const tooLong = await patch({ topicDetails: { Physics: "x".repeat(501) } });
    expect(tooLong.status).toBe(400);
    expect(((await tooLong.json()) as ErrorBody).error.code).toBe("invalid_request");
    expect((await patch({ topicDetails: { Physics: "x".repeat(500) } })).status).toBe(200);

    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as ErrorBody).error.code).toBe("invalid_request");
  });
});

describe("deck counts", () => {
  it("splits due into new and review, and counts learned only once spaced 21 days", async () => {
    const deckId = await topicsDeck(["Optics"], 4);
    const { cards, questions } = db.handle.schema;
    const rows = await db.handle.db
      .select({ cardId: cards.id })
      .from(cards)
      .innerJoin(questions, eq(cards.itemId, questions.id))
      .where(eq(questions.deckId, deckId));
    expect(rows).toHaveLength(4);
    const day = 86_400_000;
    const past = new Date(Date.now() - day);
    const later = new Date(Date.now() + 10 * day);
    // One stays new. One was answered and is due again. One is spaced 30 days, one 5.
    // Asked at different times: the one asked most recently (an hour ago) should lead.
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const states = [
      { status: "active" as const, due: past, scheduledDays: 2, reps: 2, lastReview: hoursAgo(30) },
      {
        status: "active" as const,
        due: later,
        scheduledDays: 30,
        reps: 5,
        lastReview: hoursAgo(1),
      },
      { status: "active" as const, due: later, scheduledDays: 5, reps: 1, lastReview: hoursAgo(5) },
    ];
    for (const [i, state] of states.entries()) {
      await db.handle.db
        .update(cards)
        .set(state)
        .where(eq(cards.id, rows[i + 1]!.cardId));
    }
    await db.handle.db.update(cards).set({ due: past }).where(eq(cards.id, rows[0]!.cardId));

    const listed = (await (await api.listDecks(send("GET", "/api/decks"))).json()) as {
      decks: { id: string; counts: Record<string, number> }[];
    };
    const counts = listed.decks.find((d) => d.id === deckId)!.counts;
    expect(counts).toMatchObject({
      total: 4,
      new: 1,
      due: 2,
      dueNew: 1,
      dueReview: 1,
      learned: 1,
    });

    const detail = (await (
      await api.getDeck(deckId)(send("GET", `/api/decks/${deckId}`))
    ).json()) as {
      questions: {
        id: string;
        progress: { state: string; timesAsked: number; lastAskedAt: string | null } | null;
      }[];
    };
    // Not yet asked first, then most recently asked.
    expect(detail.questions.map((q) => q.progress?.state)).toEqual([
      "new",
      "learned",
      "learning",
      "due",
    ]);
    expect(detail.questions.map((q) => q.progress?.timesAsked)).toEqual([0, 5, 1, 2]);
    expect(detail.questions[0]!.progress?.lastAskedAt).toBeNull();
    // When each comes next is not given away.
    expect(detail.questions.every((q) => !("due" in (q.progress ?? {})))).toBe(true);
    // One entry per question, however many times each has been asked.
    expect(new Set(detail.questions.map((q) => q.id)).size).toBe(detail.questions.length);
  });
  it("gives each asked question the user's last answer, skipping undone reviews", async () => {
    const deckId = await topicsDeck(["Optics"], 2);
    const { cards, questions, reviewLogs } = db.handle.schema;
    const rows = await db.handle.db
      .select({ cardId: cards.id, questionId: questions.id })
      .from(cards)
      .innerJoin(questions, eq(cards.itemId, questions.id))
      .where(eq(questions.deckId, deckId));
    const asked = rows[0]!;
    const scope = scopeFor(db.handle, ownerId);
    await db.handle.db
      .update(cards)
      .set({ status: "active", reps: 3, lastReview: new Date() })
      .where(eq(cards.id, asked.cardId));

    const snapshot = { due: new Date().toISOString() } as never;
    let minute = 0;
    async function answer(text: string, verdict: "correct" | "partial", undone: boolean) {
      minute += 1;
      const gradeId = await saveGrade(scope, {
        questionId: asked.questionId,
        userAnswer: text,
        score: verdict === "correct" ? 90 : 50,
        verdict,
        result: {},
        model: "mock",
      });
      const at = new Date(Date.now() - (10 - minute) * 60_000);
      await db.handle.db
        .update(db.handle.schema.grades)
        .set({ createdAt: at })
        .where(eq(db.handle.schema.grades.id, gradeId));
      await db.handle.db.insert(reviewLogs).values({
        id: `log${minute}`,
        userId: ownerId,
        cardId: asked.cardId,
        action: "rate",
        gradeId,
        cardBefore: snapshot,
        cardAfter: snapshot,
        undone,
        createdAt: at,
      });
    }
    await answer("Light bends towards the normal", "partial", false);
    await answer("Snell's law: n1 sin i = n2 sin r", "correct", false);
    // Answered once more, then undone: this one must not show.
    await answer("No idea", "partial", true);

    const detail = (await (
      await api.getDeck(deckId)(send("GET", `/api/decks/${deckId}`))
    ).json()) as {
      questions: {
        id: string;
        lastAnswer: { text: string; verdict: string; score: number } | null;
      }[];
    };
    const byId = new Map(detail.questions.map((q) => [q.id, q]));
    expect(byId.get(asked.questionId)!.lastAnswer).toMatchObject({
      text: "Snell's law: n1 sin i = n2 sin r",
      verdict: "correct",
      score: 90,
    });
    expect(byId.get(rows[1]!.questionId)!.lastAnswer).toBeNull();
  });
});

describe("pausing a deck", () => {
  const pause = (deckId: string, paused: boolean) =>
    api.renameDeck(deckId)(send("PATCH", `/api/decks/${deckId}`, { paused }));

  async function askedDecks(): Promise<Set<string>> {
    const scope = scopeFor(db.handle, ownerId);
    const { questions } = db.handle.schema;
    const candidates = await loadSessionCandidates(scope, {
      eligibleUntil: new Date(Date.now() + 60_000),
    });
    const ids = candidates.filter((c) => c.itemType === "question").map((c) => c.itemId);
    const rows = await db.handle.db.select().from(questions);
    return new Set(rows.filter((row) => ids.includes(row.id)).map((row) => row.deckId));
  }

  it("keeps its questions out of sessions and due counts, and resuming brings them back", async () => {
    const physics = await topicsDeck(["Physics"], 2);
    const history = await topicsDeck(["History"], 3);
    const scope = scopeFor(db.handle, ownerId);
    const soon = new Date(Date.now() + 60_000);
    expect((await dueCounts(scope, soon)).questionsDue).toBe(5);

    const res = await pause(history, true);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deck: { pausedAt: string | null; counts: { total: number } };
    };
    expect(body.deck.pausedAt).not.toBeNull();
    // Nothing is deleted: the deck still holds all its questions.
    expect(body.deck.counts.total).toBe(3);

    expect(await askedDecks()).toEqual(new Set([physics]));
    expect((await dueCounts(scope, soon)).questionsDue).toBe(2);

    const resumed = (await (await pause(history, false)).json()) as {
      deck: { pausedAt: string | null };
    };
    expect(resumed.deck.pausedAt).toBeNull();
    expect(await askedDecks()).toEqual(new Set([physics, history]));
    expect((await dueCounts(scope, soon)).questionsDue).toBe(5);
  });

  it("gets no new questions while paused, and does not count towards the target", async () => {
    const scope = scopeFor(db.handle, ownerId);
    const physics = await topicsDeck(["Physics"], 1);
    await seeAllQuestions();
    const history = await topicsDeck(["History"], 3);
    await pause(history, true);
    await pause(physics, true);
    await updateSettings(scope, {
      maxNewQuestions: 3,
      cadence: "daily",
      sendTime: "09:00",
      timezone: "UTC",
    });
    await queueTopUps({ handle: db.handle, now: new Date("2026-11-16T08:50:00Z") });
    await run();
    // Both paused: nothing written for either.
    expect((await unseenQuestionsByDeck(scope)).get(physics)).toBeUndefined();

    // Physics resumed: History's 3 unseen no longer cover the target, so Physics gets 3.
    await pause(physics, false);
    await queueTopUps({ handle: db.handle, now: new Date("2026-11-17T08:50:00Z") });
    await run();
    const unseen = await unseenQuestionsByDeck(scope);
    expect(unseen.get(physics)).toBe(3);
    expect(unseen.get(history)).toBe(3);
  });
});
