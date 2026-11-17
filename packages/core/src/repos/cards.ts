// SPDX-License-Identifier: AGPL-3.0-only
// Card storage and the review log (PRD 9.6, 10).
//
// Every card change goes through saveCardAfterAction, which writes the card and its
// review log in one transaction. That pairing is what makes undo possible: the log holds
// the before snapshot, so undo is a restore rather than a recomputation.

import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { newId } from "../ids";
import type { CardStatus, Channel, ItemType, ReviewAction } from "../db/types";
import { fromSnapshot, snapshot, type SchedulableCard } from "../scheduler/scheduler";
import type { SessionCandidate } from "../scheduler/session-builder";
import type { Scope } from "./context";
import { withTransaction } from "../db/transaction";

export interface CardRow extends SchedulableCard {
  itemType: ItemType;
  itemId: string;
}

function toSchedulable(row: {
  id: string;
  status: string;
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  fsrsState: number;
  lastReview: Date | null;
  skipCount: number;
  itemType: string;
  itemId: string;
}): CardRow {
  return {
    id: row.id,
    status: row.status as CardStatus,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    scheduledDays: row.scheduledDays,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learningSteps,
    fsrsState: row.fsrsState,
    lastReview: row.lastReview,
    skipCount: row.skipCount,
    itemType: row.itemType as ItemType,
    itemId: row.itemId,
  };
}

export async function findCardById(scope: Scope, cardId: string): Promise<CardRow | null> {
  const { cards } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, scope.userId), eq(cards.id, cardId)))
    .limit(1);
  const row = rows[0];
  return row ? toSchedulable(row) : null;
}

export async function findCardForItem(
  scope: Scope,
  item: { type: ItemType; id: string },
): Promise<CardRow | null> {
  const { cards } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(cards)
    .where(
      and(eq(cards.userId, scope.userId), eq(cards.itemType, item.type), eq(cards.itemId, item.id)),
    )
    .limit(1);
  const row = rows[0];
  return row ? toSchedulable(row) : null;
}

/**
 * Everything that could go in a session, for the session builder to choose from. Loading
 * the candidates and choosing between them are kept apart so the choosing stays a pure
 * function with no database in it (PRD 9.5).
 */
export async function loadSessionCandidates(
  scope: Scope,
  input: { eligibleUntil: Date; lastSessionId?: string | null },
): Promise<SessionCandidate[]> {
  const { cards, links, questions, decks, sessionItems } = scope.handle.schema;

  const eligibleStatuses: CardStatus[] = ["new", "active", "unread", "snoozed", "expiring"];

  const rows = await scope.handle.db
    .select({
      card: cards,
      linkSavedAt: links.savedAt,
      linkAiStatus: links.aiStatus,
      questionPosition: questions.position,
    })
    .from(cards)
    .leftJoin(links, and(eq(cards.itemType, "link"), eq(links.id, cards.itemId)))
    .leftJoin(questions, and(eq(cards.itemType, "question"), eq(questions.id, cards.itemId)))
    .leftJoin(decks, eq(decks.id, questions.deckId))
    .where(
      and(
        eq(cards.userId, scope.userId),
        inArray(cards.status, eligibleStatuses),
        lte(cards.due, input.eligibleUntil),
        // A paused deck keeps its questions but none are asked. Links have no deck.
        isNull(decks.pausedAt),
      ),
    )
    .orderBy(asc(cards.due));

  // Which cards the user skipped last time, so they go first this time (PRD 9.5 step 4).
  let skipped = new Set<string>();
  if (input.lastSessionId) {
    const skippedRows = await scope.handle.db
      .select({ cardId: sessionItems.cardId })
      .from(sessionItems)
      .where(
        and(
          eq(sessionItems.userId, scope.userId),
          eq(sessionItems.sessionId, input.lastSessionId),
          eq(sessionItems.status, "skipped"),
        ),
      );
    skipped = new Set(skippedRows.map((row) => row.cardId));
  }

  return rows.map((row) => {
    const base = toSchedulable(row.card);
    return {
      ...base,
      ...(row.linkSavedAt ? { savedAt: row.linkSavedAt } : {}),
      // A link whose summary is still being written is not useful in a session yet.
      ready: row.card.itemType === "link" ? row.linkAiStatus !== "pending" : true,
      ...(row.questionPosition !== null ? { deckPosition: row.questionPosition } : {}),
      skippedLastTime: skipped.has(row.card.id),
    };
  });
}

export interface SaveCardActionInput {
  card: SchedulableCard;
  action: ReviewAction;
  rating?: number | null;
  suggestedRating?: number | null;
  gradeId?: string | null;
  sessionId?: string | null;
  channel?: Channel;
  /** The snapshot taken before the action, which undo restores. */
  before: ReturnType<typeof snapshot>;
  fsrsLog?: Record<string, unknown> | null;
  durationMs?: number | null;
}

export interface SaveCardActionResult {
  reviewId: string;
}

/** The card and its review log, written together or not at all. */
export async function saveCardAfterAction(
  scope: Scope,
  input: SaveCardActionInput,
): Promise<SaveCardActionResult> {
  const { cards, reviewLogs } = scope.handle.schema;
  const now = new Date();
  const reviewId = newId(now);
  const after = snapshot(input.card);

  await withTransaction(scope.handle, async (tx) => {
    await tx
      .update(cards)
      .set({
        status: input.card.status,
        due: input.card.due,
        stability: input.card.stability,
        difficulty: input.card.difficulty,
        scheduledDays: input.card.scheduledDays,
        reps: input.card.reps,
        lapses: input.card.lapses,
        learningSteps: input.card.learningSteps,
        fsrsState: input.card.fsrsState,
        lastReview: input.card.lastReview,
        skipCount: input.card.skipCount,
        updatedAt: now,
      })
      .where(and(eq(cards.userId, scope.userId), eq(cards.id, input.card.id)));

    await tx.insert(reviewLogs).values({
      id: reviewId,
      userId: scope.userId,
      cardId: input.card.id,
      sessionId: input.sessionId ?? null,
      action: input.action,
      rating: input.rating ?? null,
      suggestedRating: input.suggestedRating ?? null,
      gradeId: input.gradeId ?? null,
      channel: input.channel ?? "web",
      cardBefore: input.before,
      cardAfter: after,
      fsrsLog: input.fsrsLog ?? null,
      durationMs: input.durationMs ?? null,
      undone: false,
      createdAt: now,
    });
  });

  return { reviewId };
}

/**
 * Undo (PRD 8.3 FR-S-5). Restores the card from the before snapshot and marks the log
 * undone, so the same review cannot be undone twice.
 */
export async function undoReview(
  scope: Scope,
  reviewId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { cards, reviewLogs } = scope.handle.schema;

  const rows = await scope.handle.db
    .select()
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, scope.userId), eq(reviewLogs.id, reviewId)))
    .limit(1);
  const review = rows[0];

  if (!review) return { ok: false, reason: "That action is not in your history." };
  if (review.undone) return { ok: false, reason: "That has already been undone." };

  const restored = fromSnapshot(review.cardId, review.cardBefore);
  const now = new Date();

  await withTransaction(scope.handle, async (tx) => {
    await tx
      .update(cards)
      .set({
        status: restored.status,
        due: restored.due,
        stability: restored.stability,
        difficulty: restored.difficulty,
        scheduledDays: restored.scheduledDays,
        reps: restored.reps,
        lapses: restored.lapses,
        learningSteps: restored.learningSteps,
        fsrsState: restored.fsrsState,
        lastReview: restored.lastReview,
        skipCount: restored.skipCount,
        updatedAt: now,
      })
      .where(and(eq(cards.userId, scope.userId), eq(cards.id, review.cardId)));

    await tx
      .update(reviewLogs)
      .set({ undone: true })
      .where(and(eq(reviewLogs.userId, scope.userId), eq(reviewLogs.id, reviewId)));

    // Back into its session too, so reopening the session shows the card again rather
    // than skipping past it. A session the action had finished opens again.
    if (review.sessionId) {
      const { sessionItems, sessions } = scope.handle.schema;
      await tx
        .update(sessionItems)
        .set({ status: "pending", doneAt: null })
        .where(
          and(
            eq(sessionItems.userId, scope.userId),
            eq(sessionItems.sessionId, review.sessionId),
            eq(sessionItems.cardId, review.cardId),
          ),
        );
      await tx
        .update(sessions)
        .set({ status: "open", completedAt: null })
        .where(
          and(
            eq(sessions.userId, scope.userId),
            eq(sessions.id, review.sessionId),
            eq(sessions.status, "done"),
          ),
        );
    }

    // The undo is itself recorded, so the history stays a true account of what happened.
    await tx.insert(reviewLogs).values({
      id: newId(now),
      userId: scope.userId,
      cardId: review.cardId,
      sessionId: review.sessionId,
      action: "undo",
      channel: review.channel,
      cardBefore: review.cardAfter,
      cardAfter: review.cardBefore,
      undone: false,
      createdAt: now,
    });
  });

  return { ok: true };
}

export async function updateCardStatus(
  scope: Scope,
  cardId: string,
  status: CardStatus,
): Promise<void> {
  const { cards } = scope.handle.schema;
  await scope.handle.db
    .update(cards)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(cards.userId, scope.userId), eq(cards.id, cardId)));
}

export interface DueCounts {
  questionsDue: number;
  linksDue: number;
  newQuestions: number;
}

export async function dueCounts(scope: Scope, until: Date): Promise<DueCounts> {
  const { cards, questions, decks } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({
      itemType: cards.itemType,
      status: cards.status,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(cards)
    .leftJoin(questions, and(eq(cards.itemType, "question"), eq(questions.id, cards.itemId)))
    .leftJoin(decks, eq(decks.id, questions.deckId))
    // Questions in a paused deck are not due: they are not going to be asked.
    .where(and(eq(cards.userId, scope.userId), lte(cards.due, until), isNull(decks.pausedAt)))
    .groupBy(cards.itemType, cards.status);

  const counts: DueCounts = { questionsDue: 0, linksDue: 0, newQuestions: 0 };
  for (const row of rows) {
    const n = Number(row.count);
    if (row.itemType === "question") {
      if (row.status === "new") counts.newQuestions += n;
      if (row.status === "new" || row.status === "active") counts.questionsDue += n;
    } else if (["unread", "snoozed", "expiring"].includes(row.status)) {
      counts.linksDue += n;
    }
  }
  return counts;
}

/**
 * Whether the user has any schedulable card at all. The session builder only ever sees
 * cards that are already eligible, so it cannot tell "you have saved nothing" from "you
 * are caught up". Those need different words on screen (PRD 12.3), so the service asks
 * this instead of guessing.
 */
export async function hasAnyCards(scope: Scope): Promise<boolean> {
  const { cards } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, scope.userId),
        inArray(cards.status, ["new", "active", "unread", "snoozed", "expiring"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
