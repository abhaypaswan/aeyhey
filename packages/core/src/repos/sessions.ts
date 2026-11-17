// SPDX-License-Identifier: AGPL-3.0-only
// Session storage (PRD 8.3, 9.5, 10).
//
// A session is valid until the user's next scheduled send time. After that a new one is
// built, and anything unfinished goes back into the pool unchanged rather than being
// carried forward: the scheduler already knows when those cards are due.

import { and, desc, eq, inArray } from "drizzle-orm";
import { newId } from "../ids";
import type { SessionItemStatus, SessionStats, SessionTrigger } from "../db/types";
import { withTransaction } from "../db/transaction";
import type { Scope } from "./context";

export interface SessionRow {
  id: string;
  status: "open" | "done" | "expired";
  trigger: SessionTrigger;
  validUntil: Date;
  stats: SessionStats | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface SessionItemRow {
  cardId: string;
  position: number;
  status: SessionItemStatus;
  displayedAt: Date | null;
  doneAt: Date | null;
}

export async function findOpenSession(
  scope: Scope,
  now = new Date(),
): Promise<{ session: SessionRow; items: SessionItemRow[] } | null> {
  const { sessions, sessionItems } = scope.handle.schema;

  const rows = await scope.handle.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, scope.userId), eq(sessions.status, "open")))
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  const session = rows[0];
  if (!session) return null;

  // Past its window, so it is stale. The caller builds a fresh one.
  if (session.validUntil.getTime() <= now.getTime()) {
    await expireSession(scope, session.id);
    return null;
  }

  const items = await scope.handle.db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.userId, scope.userId), eq(sessionItems.sessionId, session.id)))
    .orderBy(sessionItems.position);

  return { session, items };
}

export async function createSession(
  scope: Scope,
  input: { cardIds: string[]; validUntil: Date; trigger: SessionTrigger },
): Promise<SessionRow> {
  const { sessions, sessionItems } = scope.handle.schema;
  const now = new Date();
  const id = newId(now);

  const session = {
    id,
    userId: scope.userId,
    status: "open" as const,
    trigger: input.trigger,
    validUntil: input.validUntil,
    stats: null,
    createdAt: now,
    completedAt: null,
  };

  await withTransaction(scope.handle, async (tx) => {
    // Only one session is open at a time, so anything still open is closed first.
    await tx
      .update(sessions)
      .set({ status: "expired" })
      .where(and(eq(sessions.userId, scope.userId), eq(sessions.status, "open")));

    await tx.insert(sessions).values(session);

    if (input.cardIds.length > 0) {
      await tx.insert(sessionItems).values(
        input.cardIds.map((cardId, index) => ({
          userId: scope.userId,
          sessionId: id,
          cardId,
          position: index,
          status: "pending" as SessionItemStatus,
          displayedAt: null,
          doneAt: null,
        })),
      );
    }
  });

  return session;
}

export async function markItemDisplayed(
  scope: Scope,
  sessionId: string,
  cardId: string,
): Promise<void> {
  const { sessionItems } = scope.handle.schema;
  await scope.handle.db
    .update(sessionItems)
    .set({ displayedAt: new Date() })
    .where(
      and(
        eq(sessionItems.userId, scope.userId),
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.cardId, cardId),
      ),
    );
}

export async function markItemDone(
  scope: Scope,
  sessionId: string,
  cardId: string,
  status: "done" | "skipped",
): Promise<void> {
  const { sessionItems } = scope.handle.schema;
  await scope.handle.db
    .update(sessionItems)
    .set({ status, doneAt: new Date() })
    .where(
      and(
        eq(sessionItems.userId, scope.userId),
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.cardId, cardId),
      ),
    );
}

export interface SessionProgress {
  total: number;
  done: number;
  /** 1-based, for "2 of 5". */
  position: number;
  remainingCardIds: string[];
  finished: boolean;
}

export async function sessionProgress(scope: Scope, sessionId: string): Promise<SessionProgress> {
  const { sessionItems } = scope.handle.schema;

  const items = await scope.handle.db
    .select()
    .from(sessionItems)
    .where(and(eq(sessionItems.userId, scope.userId), eq(sessionItems.sessionId, sessionId)))
    .orderBy(sessionItems.position);

  const pending = items.filter((item) => item.status === "pending");
  const done = items.length - pending.length;

  return {
    total: items.length,
    done,
    position: Math.min(done + 1, items.length),
    remainingCardIds: pending.map((item) => item.cardId),
    finished: pending.length === 0,
  };
}

export async function completeSession(
  scope: Scope,
  sessionId: string,
  stats: SessionStats,
): Promise<void> {
  const { sessions } = scope.handle.schema;
  await scope.handle.db
    .update(sessions)
    .set({ status: "done", stats, completedAt: new Date() })
    .where(and(eq(sessions.userId, scope.userId), eq(sessions.id, sessionId)));
}

export async function expireSession(scope: Scope, sessionId: string): Promise<void> {
  const { sessions } = scope.handle.schema;
  await scope.handle.db
    .update(sessions)
    .set({ status: "expired" })
    .where(and(eq(sessions.userId, scope.userId), eq(sessions.id, sessionId)));
}

/**
 * Counts an unanswered card as ignored when its session window closes. This is the only
 * thing that increments ignored_count, and it is what "shown" means for expiry
 * (PRD 14.5, 9.4).
 */
export async function recordIgnoredLinks(scope: Scope, sessionId: string): Promise<number> {
  const { sessionItems, cards, links } = scope.handle.schema;

  const pending = await scope.handle.db
    .select({ cardId: sessionItems.cardId, itemId: cards.itemId })
    .from(sessionItems)
    .innerJoin(cards, eq(cards.id, sessionItems.cardId))
    .where(
      and(
        eq(sessionItems.userId, scope.userId),
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.status, "pending"),
        eq(cards.itemType, "link"),
      ),
    );

  if (pending.length === 0) return 0;

  // Only links that were actually put in front of the user count. One that was built into
  // a session the user never opened was never shown.
  const displayed = await scope.handle.db
    .select({ cardId: sessionItems.cardId })
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.userId, scope.userId),
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.status, "pending"),
      ),
    );
  const displayedIds = new Set(displayed.map((row) => row.cardId));

  const linkIds = pending.filter((row) => displayedIds.has(row.cardId)).map((row) => row.itemId);
  if (linkIds.length === 0) return 0;

  const { sql } = await import("drizzle-orm");
  await scope.handle.db
    .update(links)
    .set({ ignoredCount: sql`${links.ignoredCount} + 1`, updatedAt: new Date() })
    .where(and(eq(links.userId, scope.userId), inArray(links.id, linkIds)));

  return linkIds.length;
}

export async function lastSessionId(scope: Scope): Promise<string | null> {
  const { sessions } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, scope.userId))
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}
