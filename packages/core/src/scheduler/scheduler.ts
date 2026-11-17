// SPDX-License-Identifier: AGPL-3.0-only
// Every FSRS call in Aeyhey happens in this file (PRD 9.1). An ESLint rule blocks
// importing ts-fsrs anywhere else, so there is exactly one place that decides when a
// card comes back.
//
// Two engines, one algorithm:
//   questionFsrs  memory scheduling, the normal flashcard job, capped at a year
//   linkFsrs      attention scheduling, capped at 4 months. A repeated snooze is rated
//                 Good, and FSRS's own interval growth is what makes a link you keep
//                 putting off show up less and less.
//
// enable_short_term is off for both: sessions are daily at the fastest, so minute-level
// learning steps would only produce intervals the user never sees.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade,
  type ReviewLog as FsrsReviewLog,
} from "ts-fsrs";
import type { CardSnapshot, CardStatus } from "../db/types";

export { Rating, State };
export type { Grade };

/** Score to rating thresholds (PRD 9.3, Appendix C). Tunable in one place. */
export const GRADE_THRESHOLDS = { hard: 40, good: 65, easy: 90 } as const;

export const MAX_QUESTION_INTERVAL_DAYS = 365;
export const MAX_LINK_INTERVAL_DAYS = 120;

export function questionFsrs(retention = 0.9): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: retention,
      maximum_interval: MAX_QUESTION_INTERVAL_DAYS,
      enable_fuzz: true,
      enable_short_term: false,
    }),
  );
}

export function linkFsrs(): FSRS {
  return fsrs(
    generatorParameters({
      request_retention: 0.9,
      maximum_interval: MAX_LINK_INTERVAL_DAYS,
      enable_fuzz: true,
      enable_short_term: false,
    }),
  );
}

// ---------------------------------------------------------------- card conversion

/** The scheduler's view of a row in the cards table. No database types in here. */
export interface SchedulableCard {
  id: string;
  status: CardStatus;
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
}

export function toFsrsCard(card: SchedulableCard): FsrsCard {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learningSteps,
    state: card.fsrsState as State,
    last_review: card.lastReview ?? undefined,
  } as FsrsCard;
}

export function fromFsrsCard(
  id: string,
  status: CardStatus,
  skipCount: number,
  card: FsrsCard,
): SchedulableCard {
  return {
    id,
    status,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps ?? 0,
    fsrsState: card.state,
    lastReview: card.last_review ?? null,
    skipCount,
  };
}

export function newCard(input: { id: string; status: CardStatus; now?: Date }): SchedulableCard {
  const empty = createEmptyCard(input.now ?? new Date());
  return fromFsrsCard(input.id, input.status, 0, empty);
}

export function snapshot(card: SchedulableCard): CardSnapshot {
  return {
    status: card.status,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learningSteps,
    fsrsState: card.fsrsState,
    lastReview: card.lastReview?.getTime() ?? null,
    skipCount: card.skipCount,
  };
}

export function fromSnapshot(id: string, snap: CardSnapshot): SchedulableCard {
  return {
    id,
    status: snap.status,
    due: new Date(snap.due),
    stability: snap.stability,
    difficulty: snap.difficulty,
    scheduledDays: snap.scheduledDays,
    reps: snap.reps,
    lapses: snap.lapses,
    learningSteps: snap.learningSteps,
    fsrsState: snap.fsrsState,
    lastReview: snap.lastReview === null ? null : new Date(snap.lastReview),
    skipCount: snap.skipCount,
  };
}

// ---------------------------------------------------------------- ratings

export function ratingFromScore(score: number): Grade {
  if (score >= GRADE_THRESHOLDS.easy) return Rating.Easy;
  if (score >= GRADE_THRESHOLDS.good) return Rating.Good;
  if (score >= GRADE_THRESHOLDS.hard) return Rating.Hard;
  return Rating.Again;
}

const RATING_WORDS = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

export function ratingFromWord(word: keyof typeof RATING_WORDS): Grade {
  return RATING_WORDS[word];
}

export function ratingToWord(rating: Grade): "again" | "hard" | "good" | "easy" {
  switch (rating) {
    case Rating.Again:
      return "again";
    case Rating.Hard:
      return "hard";
    case Rating.Easy:
      return "easy";
    default:
      return "good";
  }
}

// ---------------------------------------------------------------- applying an action

export interface SchedulerResult {
  card: SchedulableCard;
  /** The raw ts-fsrs log, stored on the review row so undo has everything it needs. */
  fsrsLog: FsrsReviewLog | null;
  /** What the UI tells the user, for example "Back in about 2 weeks". */
  nextDueLabel: string;
}

/** How a question card moves (PRD 9.3). */
export type QuestionAction =
  | { kind: "rate"; rating: Grade }
  | { kind: "skip"; nextSessionAt: Date }
  | { kind: "suspend" }
  | { kind: "unsuspend" };

export function applyQuestionAction(input: {
  card: SchedulableCard;
  action: QuestionAction;
  now?: Date;
  retention?: number;
}): SchedulerResult {
  const now = input.now ?? new Date();
  const { card, action } = input;

  if (action.kind === "suspend") {
    return {
      card: { ...card, status: "suspended" },
      fsrsLog: null,
      nextDueLabel: "Suspended",
    };
  }

  if (action.kind === "unsuspend") {
    // Back in the pool right away. FSRS handles an early or late review on its own.
    return {
      card: { ...card, status: "active", due: now },
      fsrsLog: null,
      nextDueLabel: "Back in your next session",
    };
  }

  if (action.kind === "skip") {
    // A skip is deliberately not an FSRS rating: the user told us nothing about whether
    // they remember it, so inventing a rating would corrupt the memory model.
    return {
      card: {
        ...card,
        due: action.nextSessionAt,
        skipCount: card.skipCount + 1,
      },
      fsrsLog: null,
      nextDueLabel: "Your next session",
    };
  }

  const engine = questionFsrs(input.retention ?? 0.9);
  const { card: next, log } = engine.next(toFsrsCard(card), now, action.rating);
  const updated = fromFsrsCard(card.id, "active", 0, next);
  return { card: updated, fsrsLog: log, nextDueLabel: describeInterval(now, updated.due) };
}

/** How a link card moves (PRD 9.4). */
export type LinkAction =
  | { kind: "read" }
  | { kind: "snooze"; variant: "tomorrow" | "default" | "much_later" }
  | { kind: "drop" }
  | { kind: "expire" }
  | { kind: "restore" }
  | { kind: "bring_back"; variant?: "tomorrow" | "default" | "much_later" };

const SNOOZE_RATING: Record<"tomorrow" | "default" | "much_later", Grade> = {
  tomorrow: Rating.Hard,
  default: Rating.Good,
  much_later: Rating.Easy,
};

export function applyLinkAction(input: {
  card: SchedulableCard;
  action: LinkAction;
  now?: Date;
}): SchedulerResult {
  const now = input.now ?? new Date();
  const { card, action } = input;
  const engine = linkFsrs();

  switch (action.kind) {
    case "read":
      return {
        card: { ...card, status: "read", skipCount: 0 },
        fsrsLog: null,
        nextDueLabel: "Done. It will not come back.",
      };

    case "drop":
      return {
        card: { ...card, status: "dropped", skipCount: 0 },
        fsrsLog: null,
        nextDueLabel: "Dropped. You can restore it from the inbox.",
      };

    case "expire":
      return {
        card: { ...card, status: "expired" },
        fsrsLog: null,
        nextDueLabel: "Expired. It is still searchable.",
      };

    case "restore": {
      // A restored link starts clean, so an old backlog does not come back as overdue.
      const forgotten = engine.forget(toFsrsCard(card), now, true);
      return {
        card: fromFsrsCard(card.id, "unread", 0, forgotten.card),
        fsrsLog: forgotten.log,
        nextDueLabel: "Back in your next session",
      };
    }

    case "snooze":
    case "bring_back": {
      const variant = action.kind === "snooze" ? action.variant : (action.variant ?? "default");
      const { card: next, log } = engine.next(toFsrsCard(card), now, SNOOZE_RATING[variant]);
      const updated = fromFsrsCard(card.id, "snoozed", 0, next);
      return { card: updated, fsrsLog: log, nextDueLabel: describeInterval(now, updated.due) };
    }
  }
}

// ---------------------------------------------------------------- undo and inspection

/**
 * Undo (PRD 8.3 FR-S-5). We prefer the stored before-snapshot because it restores the
 * app-level status and skip_count too, which ts-fsrs knows nothing about. rollback is
 * kept for the FSRS-only path.
 */
export function undoToSnapshot(id: string, before: CardSnapshot): SchedulableCard {
  return fromSnapshot(id, before);
}

export function rollback(
  card: SchedulableCard,
  log: FsrsReviewLog,
  isLink: boolean,
): SchedulableCard {
  const engine = isLink ? linkFsrs() : questionFsrs();
  const reverted = engine.rollback(toFsrsCard(card), log);
  return fromFsrsCard(card.id, card.status, card.skipCount, reverted);
}

/**
 * How likely the user still remembers this, 0 to 1. Used to order a session so the cards
 * closest to being forgotten come first. ts-fsrs v6 names this `retrievability` and takes
 * (card, now); it returns 0 for a card that has never been reviewed.
 */
export function retrievability(card: SchedulableCard, now = new Date(), isLink = false): number {
  if (card.fsrsState === State.New) return 0;
  const engine = isLink ? linkFsrs() : questionFsrs();
  return engine.retrievability(toFsrsCard(card), now) as unknown as number;
}

export function forget(card: SchedulableCard, now = new Date(), isLink = false): SchedulableCard {
  const engine = isLink ? linkFsrs() : questionFsrs();
  const { card: next } = engine.forget(toFsrsCard(card), now, true);
  return fromFsrsCard(card.id, card.status, 0, next);
}

// ---------------------------------------------------------------- copy

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Plain words for an interval. The UI shows this straight after an action, so it reads
 * like a sentence rather than a date: "Back in about 2 weeks".
 */
export function describeInterval(from: Date, to: Date): string {
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  if (days <= 0) return "Back in your next session";
  if (days === 1) return "Back tomorrow";
  if (days < 7) return `Back in ${days} days`;
  if (days < 14) return "Back in about a week";
  if (days < 30) return `Back in about ${Math.round(days / 7)} weeks`;
  if (days < 60) return "Back in about a month";
  if (days < 365) return `Back in about ${Math.round(days / 30)} months`;
  return "Back in about a year";
}

/**
 * When the FSRS interval is shorter than the user's cadence, the real answer is "your
 * next session", not a date they will never be asked on (PRD 9.2).
 */
export function describeNextDue(input: {
  from: Date;
  due: Date;
  nextSessionAt: Date | null;
}): string {
  if (input.nextSessionAt && input.due <= input.nextSessionAt) {
    return "Next time: your next session";
  }
  return describeInterval(input.from, input.due);
}
