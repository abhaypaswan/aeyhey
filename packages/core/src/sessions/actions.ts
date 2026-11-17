// SPDX-License-Identifier: AGPL-3.0-only
// Card actions (PRD 8.3, 9.3, 9.4, 11).
//
// One function per thing the user can do, each of which:
//   1. loads the card and checks it is theirs
//   2. asks the scheduler what the action means
//   3. writes the card, the review log and the item row in one transaction
//   4. marks the session item done
//
// The scheduler decides every due date. Nothing in this file computes one.

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Channel, LinkStatus } from "../db/types";
import {
  applyLinkAction,
  applyQuestionAction,
  describeNextDue,
  ratingFromScore,
  snapshot,
  type Grade,
} from "../scheduler/scheduler";
import { nextSlot } from "../scheduler/cadence";
import { resolveLastChance } from "../scheduler/expiry";
import { findCardById, saveCardAfterAction, undoReview } from "../repos/cards";
import { updateLink } from "../repos/links";
import { loadSettings, toCadenceSettings } from "../repos/settings";
import { markItemDone, sessionProgress, type SessionProgress } from "../repos/sessions";
import type { Scope } from "../repos/context";
import { createLogger } from "../logger";

const log = createLogger("card-action");

/** PRD Appendix B. The boundary validates with this and nothing else. */
const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const CardActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  z.object({
    action: z.literal("snooze"),
    variant: z.enum(["tomorrow", "default", "much_later"]).default("default"),
  }),
  z.object({ action: z.literal("drop") }),
  z.object({ action: z.literal("answer"), answer: z.string().min(1).max(4000) }),
  z.object({ action: z.literal("reveal") }),
  z.object({
    action: z.literal("rate"),
    rating: Rating,
    via: z.enum(["answer", "reveal", "quick", "dont_know"]),
    gradeId: z.string().optional(),
  }),
  z.object({ action: z.literal("skip") }),
]);

export type CardAction = z.infer<typeof CardActionSchema>;

export class CardNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super("That card is not in your collection.");
    this.name = "CardNotFoundError";
  }
}

export class WrongCardKindError extends Error {
  readonly status = 400;
  constructor(action: string, kind: string) {
    super(`"${action}" does not apply to a ${kind} card.`);
    this.name = "WrongCardKindError";
  }
}

export interface ActionResult {
  cardId: string;
  /** Plain words for the UI, for example "Back in about 2 weeks". */
  nextDueLabel: string;
  reviewId: string;
  progress: SessionProgress | null;
  /** Set for a read action, so the client can open the original. */
  openUrl?: string;
}

export interface ActionContext {
  scope: Scope;
  sessionId?: string | null;
  channel?: Channel;
  durationMs?: number | null;
  now?: Date;
}

/**
 * Applies one action. The card kind decides which scheduler path runs, and an action that
 * does not apply to that kind is refused rather than quietly ignored.
 */
export async function applyCardAction(
  ctx: ActionContext,
  cardId: string,
  action: CardAction,
): Promise<ActionResult> {
  const { scope } = ctx;
  const now = ctx.now ?? new Date();

  const card = await findCardById(scope, cardId);
  if (!card) throw new CardNotFoundError();

  const settings = await loadSettings(scope);
  const nextSessionAt = nextSlot(now, toCadenceSettings(settings));
  const before = snapshot(card);

  // ---------------------------------------------------------------- link actions

  if (card.itemType === "link") {
    if (action.action === "answer" || action.action === "reveal" || action.action === "rate") {
      throw new WrongCardKindError(action.action, "link");
    }

    // A link on its last chance follows the rescue rules rather than the plain ones
    // (PRD 9.4 rule 2).
    const lastChance = card.status === "expiring";

    if (action.action === "skip") {
      // Skipping a link is not a rating and not a snooze: it stays eligible.
      const result = await saveCardAfterAction(scope, {
        card: { ...card, skipCount: card.skipCount + 1 },
        action: "skip",
        before,
        sessionId: ctx.sessionId ?? null,
        channel: ctx.channel ?? "web",
        durationMs: ctx.durationMs ?? null,
      });
      await finishItem(ctx, cardId, "skipped");
      return {
        cardId,
        nextDueLabel: "Your next session",
        reviewId: result.reviewId,
        progress: await progressOrNull(ctx),
      };
    }

    const scheduled = applyLinkAction({
      card,
      action:
        action.action === "read"
          ? { kind: "read" }
          : action.action === "drop"
            ? { kind: "drop" }
            : { kind: "snooze", variant: action.variant },
      now,
    });

    // Resolve the last chance outcome, which may override the plain status.
    // The scheduler returns a CardStatus, which is the union of both kinds; for a link
    // it is always one of the link statuses, so this narrows it for the link row.
    let status = scheduled.card.status as LinkStatus;
    let snoozeCount: number | undefined;
    let rescued: boolean | undefined;

    if (lastChance) {
      const outcome = resolveLastChance({
        candidate: {
          linkId: card.itemId,
          status: "snoozed",
          snoozeCount: 0,
          ignoredCount: 0,
          rescued: false,
          savedAt: now,
          importedAt: null,
          everShown: true,
        },
        outcome:
          action.action === "read" ? "read" : action.action === "drop" ? "dropped" : "snoozed",
      });
      status = outcome.status;
      snoozeCount = outcome.snoozeCount;
      rescued = outcome.rescued;
    }

    const { links } = scope.handle.schema;

    await updateLink(scope, card.itemId, {
      status,
      ...(action.action === "read" ? { readAt: now } : {}),
      ...(snoozeCount !== undefined ? { snoozeCount } : {}),
      ...(rescued !== undefined ? { rescued } : {}),
    });

    // A snooze that was not a rescue increments the counter, which feeds expiry.
    if (action.action === "snooze" && snoozeCount === undefined) {
      await scope.handle.db
        .update(links)
        .set({ snoozeCount: sql`${links.snoozeCount} + 1` })
        .where(and(eq(links.userId, scope.userId), eq(links.id, card.itemId)));
    }

    const result = await saveCardAfterAction(scope, {
      card: { ...scheduled.card, status },
      action: action.action === "read" ? "read" : action.action === "drop" ? "drop" : "snooze",
      before,
      sessionId: ctx.sessionId ?? null,
      channel: ctx.channel ?? "web",
      durationMs: ctx.durationMs ?? null,
      fsrsLog: (scheduled.fsrsLog as unknown as Record<string, unknown>) ?? null,
    });

    await finishItem(ctx, cardId, "done");

    let openUrl: string | undefined;
    if (action.action === "read") {
      const rows = await scope.handle.db
        .select({ url: links.url })
        .from(links)
        .where(and(eq(links.userId, scope.userId), eq(links.id, card.itemId)))
        .limit(1);
      openUrl = rows[0]?.url;
    }

    log.info("link action", { cardId, action: action.action, status });

    return {
      cardId,
      nextDueLabel: scheduled.nextDueLabel,
      reviewId: result.reviewId,
      progress: await progressOrNull(ctx),
      ...(openUrl ? { openUrl } : {}),
    };
  }

  // ---------------------------------------------------------------- question actions

  if (action.action === "read" || action.action === "drop" || action.action === "snooze") {
    throw new WrongCardKindError(action.action, "question");
  }

  // Answer and reveal do not schedule anything on their own: the user rates afterwards,
  // and that rating is the scheduling event (PRD 8.3 FR-S-3).
  if (action.action === "answer" || action.action === "reveal") {
    throw new Error(
      `"${action.action}" is handled by the question service, which needs the grader. Call it there, then send a rate action.`,
    );
  }

  if (action.action === "skip") {
    const scheduled = applyQuestionAction({
      card,
      action: { kind: "skip", nextSessionAt },
      now,
      retention: settings.requestRetention,
    });

    const result = await saveCardAfterAction(scope, {
      card: scheduled.card,
      action: "skip",
      before,
      sessionId: ctx.sessionId ?? null,
      channel: ctx.channel ?? "web",
      durationMs: ctx.durationMs ?? null,
    });

    await finishItem(ctx, cardId, "skipped");

    return {
      cardId,
      // Three skips in a row and the UI asks whether to suspend it (PRD 9.3).
      nextDueLabel:
        scheduled.card.skipCount >= 3
          ? "Your next session. You have skipped this a few times now."
          : "Your next session",
      reviewId: result.reviewId,
      progress: await progressOrNull(ctx),
    };
  }

  const scheduled = applyQuestionAction({
    card,
    action: { kind: "rate", rating: action.rating as Grade },
    now,
    retention: settings.requestRetention,
  });

  const result = await saveCardAfterAction(scope, {
    card: scheduled.card,
    action: "rate",
    rating: action.rating,
    ...(action.gradeId ? { gradeId: action.gradeId } : {}),
    before,
    sessionId: ctx.sessionId ?? null,
    channel: ctx.channel ?? "web",
    durationMs: ctx.durationMs ?? null,
    fsrsLog: (scheduled.fsrsLog as unknown as Record<string, unknown>) ?? null,
  });

  await finishItem(ctx, cardId, "done");

  log.info("question rated", { cardId, rating: action.rating, via: action.via });

  return {
    cardId,
    nextDueLabel: describeNextDue({
      from: now,
      due: scheduled.card.due,
      nextSessionAt,
    }),
    reviewId: result.reviewId,
    progress: await progressOrNull(ctx),
  };
}

/** The rating a score suggests. The server derives it so models cannot drift (PRD 13.4). */
export function suggestedRatingForScore(score: number): { rating: Grade; word: string } {
  const rating = ratingFromScore(score);
  const word = rating === 1 ? "again" : rating === 2 ? "hard" : rating === 3 ? "good" : "easy";
  return { rating, word };
}

export async function undoCardAction(
  scope: Scope,
  reviewId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return undoReview(scope, reviewId);
}

async function finishItem(
  ctx: ActionContext,
  cardId: string,
  status: "done" | "skipped",
): Promise<void> {
  if (!ctx.sessionId) return;
  await markItemDone(ctx.scope, ctx.sessionId, cardId, status);
}

async function progressOrNull(ctx: ActionContext): Promise<SessionProgress | null> {
  if (!ctx.sessionId) return null;
  return sessionProgress(ctx.scope, ctx.sessionId);
}
