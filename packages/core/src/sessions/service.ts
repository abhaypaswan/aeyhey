// SPDX-License-Identifier: AGPL-3.0-only
// Getting a session (PRD 8.3 FR-S-1, 9.5, 11).
//
// The rule that shapes this: an open session is resumed, never rebuilt. A user who closes
// the app at card 2 of 5 and comes back must see card 3, with the same remaining cards,
// not a freshly shuffled set. So a session is persisted when it is built, and the only
// thing that ends it is finishing it or its window closing.

import { buildSession } from "../scheduler/session-builder";
import { eligibilityWindow, describeNextSession, isPaused, nextSlot } from "../scheduler/cadence";
import { dueCounts, hasAnyCards, loadSessionCandidates } from "../repos/cards";
import {
  createSession,
  findOpenSession,
  lastSessionId,
  markItemDisplayed,
  recordIgnoredLinks,
  sessionProgress,
  type SessionRow,
} from "../repos/sessions";
import { loadSettings, toCadenceSettings, toSessionSettings } from "../repos/settings";
import type { Scope } from "../repos/context";
import { loadCardViews, type CardView } from "./views";
import type { SessionTrigger } from "../db/types";
import { createLogger } from "../logger";

const log = createLogger("session");

export interface SessionPayload {
  session: SessionRow | null;
  items: CardView[];
  progress: { total: number; done: number; position: number } | null;
  /** "Tuesday at 09:00". */
  nextSessionLabel: string;
  /** Why there is nothing, when there is nothing. */
  emptyReason?: "nothing_due" | "nothing_saved" | "paused";
  counts: { questionsDue: number; linksDue: number; newQuestions: number };
}

export interface GetSessionOptions {
  /** Overrides cards_per_session for a manual "do 5 more". */
  size?: number;
  trigger?: SessionTrigger;
  now?: Date;
  /** false resumes or reports empty without building anything. Used by the reminder loop. */
  build?: boolean;
}

export async function getOrBuildSession(
  scope: Scope,
  options: GetSessionOptions = {},
): Promise<SessionPayload> {
  const now = options.now ?? new Date();
  const settings = await loadSettings(scope);
  const cadence = toCadenceSettings(settings);
  const nextSessionLabel = describeNextSession(now, cadence);
  const window = eligibilityWindow(now, cadence);
  const counts = await dueCounts(scope, window.until);

  if (isPaused(now, cadence)) {
    return {
      session: null,
      items: [],
      progress: null,
      nextSessionLabel,
      emptyReason: "paused",
      counts,
    };
  }

  // Resume first. This is the whole acceptance criterion for FR-S-1.
  const open = await findOpenSession(scope, now);
  if (open) {
    const pending = open.items.filter((item) => item.status === "pending");
    const progress = await sessionProgress(scope, open.session.id);

    if (pending.length > 0) {
      const items = await loadCardViews(
        scope,
        pending.map((item) => item.cardId),
      );
      // The next card counts as shown the moment we hand it over, which is what feeds
      // ignored_count later (PRD 14.5).
      if (items[0]) await markItemDisplayed(scope, open.session.id, items[0].cardId);

      return {
        session: open.session,
        items,
        progress: { total: progress.total, done: progress.done, position: progress.position },
        nextSessionLabel,
        counts,
      };
    }

    // Finished, and still inside its window: do not build another unless asked.
    if (!options.size) {
      return {
        session: open.session,
        items: [],
        progress: { total: progress.total, done: progress.done, position: progress.position },
        nextSessionLabel,
        counts,
      };
    }
  }

  if (options.build === false) {
    return {
      session: null,
      items: [],
      progress: null,
      nextSessionLabel,
      emptyReason: counts.questionsDue + counts.linksDue > 0 ? undefined : "nothing_due",
      counts,
    };
  }

  const previousSessionId = await lastSessionId(scope);
  // Anything the user never answered in the previous session counts as ignored now.
  if (previousSessionId) await recordIgnoredLinks(scope, previousSessionId);

  const candidates = await loadSessionCandidates(scope, {
    eligibleUntil: window.until,
    lastSessionId: previousSessionId,
  });

  const built = buildSession({
    settings: {
      ...toSessionSettings(settings),
      ...(options.size ? { cardsPerSession: options.size } : {}),
    },
    candidates,
    now,
    eligibleUntil: window.until,
  });

  if (built.items.length === 0) {
    // "You have saved nothing yet" and "you are caught up" look identical from the
    // builder's side, and read very differently on screen.
    const anyCards = await hasAnyCards(scope);
    return {
      session: null,
      items: [],
      progress: null,
      nextSessionLabel,
      emptyReason: anyCards ? "nothing_due" : "nothing_saved",
      counts,
    };
  }

  const session = await createSession(scope, {
    cardIds: built.items.map((item) => item.id),
    // A session lives until the next scheduled send, then a fresh one is built.
    validUntil: nextSlot(now, cadence),
    trigger: options.trigger ?? "manual",
  });

  const items = await loadCardViews(
    scope,
    built.items.map((item) => item.id),
  );
  if (items[0]) await markItemDisplayed(scope, session.id, items[0].cardId);

  log.info("built a session", {
    sessionId: session.id,
    links: built.counts.links,
    questions: built.counts.questions,
  });

  return {
    session,
    items,
    progress: { total: items.length, done: 0, position: 1 },
    nextSessionLabel,
    counts,
  };
}

/** The end-of-session summary (PRD 8.3 FR-S-4). */
export interface SessionSummary {
  cardsDone: number;
  linksRead: number;
  linksDropped: number;
  linksSnoozed: number;
  questionsAnswered: number;
  questionsSkipped: number;
  averageScore: number | null;
  /** How many written answers were graded, the ones averageScore is over. */
  writtenAnswers: number;
  linksExpired: number;
  moreAvailable: boolean;
  nextSessionLabel: string;
}

export async function summarizeSession(
  scope: Scope,
  sessionId: string,
  now = new Date(),
): Promise<SessionSummary> {
  const { reviewLogs, grades, sessionItems } = scope.handle.schema;
  const { and, eq, inArray } = await import("drizzle-orm");

  const items = await scope.handle.db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.userId, scope.userId), eq(sessionItems.sessionId, sessionId)));

  const logs = await scope.handle.db
    .select()
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, scope.userId), eq(reviewLogs.sessionId, sessionId)));

  const live = logs.filter((entry) => !entry.undone);

  const gradeIds = live.map((entry) => entry.gradeId).filter((id): id is string => Boolean(id));
  const gradeRows =
    gradeIds.length > 0
      ? await scope.handle.db
          .select({ score: grades.score })
          .from(grades)
          .where(and(eq(grades.userId, scope.userId), inArray(grades.id, gradeIds)))
      : [];

  const averageScore =
    gradeRows.length > 0
      ? Math.round(gradeRows.reduce((sum, row) => sum + row.score, 0) / gradeRows.length)
      : null;

  const settings = await loadSettings(scope);
  const cadence = toCadenceSettings(settings);
  const window = eligibilityWindow(now, cadence);
  const counts = await dueCounts(scope, window.until);

  return {
    cardsDone: items.filter((item) => item.status !== "pending").length,
    linksRead: live.filter((entry) => entry.action === "read").length,
    linksDropped: live.filter((entry) => entry.action === "drop").length,
    linksSnoozed: live.filter((entry) => entry.action === "snooze").length,
    questionsAnswered: live.filter((entry) => entry.action === "rate").length,
    questionsSkipped: live.filter((entry) => entry.action === "skip").length,
    averageScore,
    writtenAnswers: gradeRows.length,
    linksExpired: live.filter((entry) => entry.action === "expire").length,
    moreAvailable: counts.questionsDue + counts.linksDue > 0,
    nextSessionLabel: describeNextSession(now, cadence),
  };
}
