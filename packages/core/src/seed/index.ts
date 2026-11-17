// SPDX-License-Identifier: AGPL-3.0-only
// Seeding demo mode (PRD 8.5).
//
// Runs once on first start when DEMO_MODE=true, and is safe to call again: a marker in
// app_meta stops it doubling the data. The review history is replayed through the real
// scheduler, not written as numbers, so the due dates and the stability values are
// genuinely what FSRS would have produced.

import { eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { newId } from "../ids";
import { withTransaction } from "../db/transaction";
import { createOwner, ownerExists } from "../extensions/defaults/local-auth";
import { scopeFor } from "../repos/context";
import { setItemTags } from "../repos/tags";
import {
  applyLinkAction,
  applyQuestionAction,
  newCard,
  ratingFromWord,
} from "../scheduler/scheduler";
import {
  SEED_LINKS,
  SEED_RESUME_DECK,
  SEED_RESUME_TEXT,
  SEED_TOPIC_DECK,
  type SeedQuestion,
} from "./data";
import { createLogger } from "../logger";

const log = createLogger("seed");

const SEED_MARKER = "demo_seeded_at";
const DAY_MS = 24 * 60 * 60 * 1000;

export async function isSeeded(handle: DbHandle): Promise<boolean> {
  const { appMeta } = handle.schema;
  const rows = await handle.db.select().from(appMeta).where(eq(appMeta.key, SEED_MARKER)).limit(1);
  return rows.length > 0;
}

export interface SeedResult {
  userId: string;
  links: number;
  questions: number;
  decks: number;
  reviews: number;
}

/**
 * Replays a review history through the real scheduler so the card ends up where it would
 * genuinely be. Writing plausible-looking numbers straight into the row would make the
 * demo lie about the one thing the product is actually about.
 */
function replayQuestionHistory(
  cardId: string,
  history: ("again" | "hard" | "good" | "easy")[],
  now: Date,
): { card: ReturnType<typeof newCard>; reviewedAt: Date[] } {
  let card = newCard({
    id: cardId,
    status: "new",
    now: new Date(now.getTime() - history.length * 7 * DAY_MS),
  });
  const reviewedAt: Date[] = [];
  let at = new Date(now.getTime() - history.length * 7 * DAY_MS);

  for (const word of history) {
    const result = applyQuestionAction({
      card,
      action: { kind: "rate", rating: ratingFromWord(word) },
      now: at,
    });
    card = result.card;
    reviewedAt.push(at);
    // The next review happens when the card came due, which is what a real user does.
    at = new Date(Math.min(card.due.getTime(), now.getTime()));
  }

  return { card, reviewedAt };
}

export async function seedDemoData(handle: DbHandle, now = new Date()): Promise<SeedResult | null> {
  if (await isSeeded(handle)) {
    log.info("demo data is already there, not seeding again");
    return null;
  }

  const { appMeta, links, cards, decks, questions, questionSources, reviewLogs, settings } =
    handle.schema;

  const userId = (await ownerExists(handle))
    ? (await handle.db.select().from(handle.schema.users).limit(1))[0]!.id
    : (
        await createOwner({
          handle,
          displayName: "Demo",
          timezone: "UTC",
        })
      ).id;

  const scope = scopeFor(handle, userId);
  let reviews = 0;

  // ---------------------------------------------------------------- links
  for (const seed of SEED_LINKS) {
    const savedAt = new Date(now.getTime() - seed.savedDaysAgo * DAY_MS);
    const linkId = newId(savedAt);
    const cardId = newId(savedAt);

    let card = newCard({ id: cardId, status: "unread", now: savedAt });
    const status = seed.status ?? "unread";

    // Replay the snoozes so the due date is the one FSRS would have produced.
    let at = savedAt;
    for (let i = 0; i < (seed.snoozeCount ?? 0); i += 1) {
      const result = applyLinkAction({
        card,
        action: { kind: "snooze", variant: "default" },
        now: at,
      });
      card = result.card;
      at = new Date(Math.min(card.due.getTime(), now.getTime()));
      reviews += 1;
    }

    if (status === "read") {
      card = applyLinkAction({ card, action: { kind: "read" }, now: at }).card;
      reviews += 1;
    } else if (status === "expiring") {
      card = { ...card, status: "expiring" };
    } else if ((seed.snoozeCount ?? 0) === 0) {
      // An untouched link is due now, so it can turn up in the first session.
      card = { ...card, due: now, status: "unread" };
    }

    await withTransaction(handle, async (tx) => {
      await tx.insert(links).values({
        id: linkId,
        userId,
        url: seed.url,
        urlNormalized: seed.url.replace(/^https?:\/\/(www\.)?/, "https://").replace(/\/$/, ""),
        title: seed.title,
        siteName: seed.siteName,
        contentType: seed.contentType,
        extractStatus: "ok",
        aiStatus: "ok",
        summaryLines: seed.summaryLines,
        whySaved: seed.whySaved,
        summaryConfidence: "high",
        readMinutes: seed.readMinutes,
        language: "en",
        userNote: seed.note ?? null,
        status,
        snoozeCount: seed.snoozeCount ?? 0,
        ignoredCount: 0,
        rescued: false,
        savedAt,
        importSource: "paste",
        readAt: status === "read" ? at : null,
        createdAt: savedAt,
        updatedAt: now,
      });

      await tx.insert(cards).values({
        id: cardId,
        userId,
        itemType: "link",
        itemId: linkId,
        status: card.status,
        due: card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        scheduledDays: card.scheduledDays,
        reps: card.reps,
        lapses: card.lapses,
        learningSteps: card.learningSteps,
        fsrsState: card.fsrsState,
        lastReview: card.lastReview,
        skipCount: 0,
        createdAt: savedAt,
        updatedAt: now,
      });
    });

    await setItemTags(scope, { type: "link", id: linkId }, seed.tags);
  }

  // ---------------------------------------------------------------- questions
  const resumeSourceId = newId();
  await handle.db.insert(questionSources).values({
    id: resumeSourceId,
    userId,
    kind: "resume",
    resumeText: SEED_RESUME_TEXT,
    targetRole: "Senior Backend Engineer",
    seniority: "senior",
    focus: ["projects", "skills", "system_design"],
    countPerTopic: 5,
    createdAt: new Date(now.getTime() - 20 * DAY_MS),
  });

  const topicSourceId = newId();
  await handle.db.insert(questionSources).values({
    id: topicSourceId,
    userId,
    kind: "topics",
    topics: ["Postgres", "system design"],
    level: "senior",
    style: "interview",
    countPerTopic: 5,
    createdAt: new Date(now.getTime() - 14 * DAY_MS),
  });

  let questionCount = 0;

  const seedDeck = async (
    deck: { name: string; questions: SeedQuestion[] },
    kind: "resume" | "topics",
    sourceId: string,
    createdDaysAgo: number,
  ): Promise<void> => {
    const createdAt = new Date(now.getTime() - createdDaysAgo * DAY_MS);
    const deckId = newId(createdAt);

    await handle.db.insert(decks).values({
      id: deckId,
      userId,
      name: deck.name,
      kind,
      sourceId,
      createdAt,
    });

    for (const [index, seed] of deck.questions.entries()) {
      const questionId = newId(createdAt);
      const cardId = newId(createdAt);

      const history = seed.reviewHistory ?? [];
      const { card, reviewedAt } =
        history.length > 0
          ? replayQuestionHistory(cardId, history, now)
          : { card: newCard({ id: cardId, status: "new", now }), reviewedAt: [] };

      await withTransaction(handle, async (tx) => {
        await tx.insert(questions).values({
          id: questionId,
          userId,
          deckId,
          position: index,
          text: seed.text,
          modelAnswer: seed.modelAnswer,
          keyPoints: seed.keyPoints,
          category: seed.category,
          difficulty: seed.difficulty,
          resumeAnchor: seed.resumeAnchor ?? null,
          origin: "ai",
          reviewStatus: "kept",
          createdAt,
          updatedAt: now,
        });

        await tx.insert(cards).values({
          id: cardId,
          userId,
          itemType: "question",
          itemId: questionId,
          status: history.length > 0 ? "active" : "new",
          due: card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          scheduledDays: card.scheduledDays,
          reps: card.reps,
          lapses: card.lapses,
          learningSteps: card.learningSteps,
          fsrsState: card.fsrsState,
          lastReview: card.lastReview,
          skipCount: 0,
          createdAt,
          updatedAt: now,
        });

        // Review rows, so the stats page has something to draw.
        for (const [i, at] of reviewedAt.entries()) {
          const word = history[i]!;
          await tx.insert(reviewLogs).values({
            id: newId(at),
            userId,
            cardId,
            sessionId: null,
            action: "rate",
            rating: ratingFromWord(word),
            suggestedRating: null,
            gradeId: null,
            channel: "web",
            cardBefore: {
              status: "new",
              due: at.getTime(),
              stability: 0,
              difficulty: 0,
              scheduledDays: 0,
              reps: i,
              lapses: 0,
              learningSteps: 0,
              fsrsState: 0,
              lastReview: null,
              skipCount: 0,
            },
            cardAfter: {
              status: "active",
              due: card.due.getTime(),
              stability: card.stability,
              difficulty: card.difficulty,
              scheduledDays: card.scheduledDays,
              reps: i + 1,
              lapses: card.lapses,
              learningSteps: card.learningSteps,
              fsrsState: card.fsrsState,
              lastReview: at.getTime(),
              skipCount: 0,
            },
            fsrsLog: null,
            durationMs: 20_000 + i * 3_000,
            undone: false,
            createdAt: at,
          });
          reviews += 1;
        }
      });

      await setItemTags(scope, { type: "question", id: questionId }, seed.tags);
      questionCount += 1;
    }
  };

  await seedDeck(SEED_RESUME_DECK, "resume", resumeSourceId, 20);
  await seedDeck(SEED_TOPIC_DECK, "topics", topicSourceId, 14);

  // A demo instance should feel like it has been used for a while.
  await handle.db
    .update(settings)
    .set({ cardsPerSession: 5, cadence: "daily", sendTime: "09:00", updatedAt: now })
    .where(eq(settings.userId, userId));

  await handle.db
    .insert(appMeta)
    .values({ key: SEED_MARKER, value: now.toISOString(), updatedAt: now })
    .onConflictDoNothing();

  const result: SeedResult = {
    userId,
    links: SEED_LINKS.length,
    questions: questionCount,
    decks: 3,
    reviews,
  };

  log.info("seeded the demo data", { ...result });
  return result;
}

/** pnpm demo:reset. Clears everything and seeds again (PRD 8.5 FR-DEMO-3). */
export async function resetDemoData(handle: DbHandle): Promise<SeedResult | null> {
  const schema = handle.schema;

  // Order matters only in that app_meta goes last: if this is interrupted partway, the
  // marker being gone means the next start seeds cleanly.
  for (const table of [
    schema.reviewLogs,
    schema.sessionItems,
    schema.sessions,
    schema.grades,
    schema.itemTags,
    schema.tags,
    schema.cards,
    schema.questions,
    schema.decks,
    schema.questionSources,
    schema.links,
    schema.notifications,
    schema.jobs,
    schema.aiUsage,
    schema.appMeta,
  ]) {
    await handle.db.delete(table);
  }

  log.info("cleared the demo data");
  return seedDemoData(handle);
}

export async function ensureDemoData(
  handle: DbHandle,
  demoMode: boolean,
): Promise<SeedResult | null> {
  if (!demoMode) return null;
  return seedDemoData(handle);
}

export * from "./data";
