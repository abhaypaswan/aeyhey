// SPDX-License-Identifier: AGPL-3.0-only
// When someone last used Aeyhey, so reminders can ease off for someone who has gone
// quiet (see scheduler/reminder-pace.ts).

import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, max, or } from "drizzle-orm";
import type { DbHandle } from "../db/client";

/** A visit is written at most this often, so a busy session is not a write per request. */
const SEEN_EVERY_MS = 60 * 60 * 1000;

/** Notes that they used the app or the API. Cheap when it was already noted this hour. */
export async function markSeen(handle: DbHandle, userId: string, now = new Date()): Promise<void> {
  if (!userId) return;
  const { users } = handle.schema;
  await handle.db
    .update(users)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.lastSeenAt), lt(users.lastSeenAt, new Date(now.getTime() - SEEN_EVERY_MS))),
      ),
    );
}

/**
 * The latest sign they were here: a visit, a card answered or acted on (Telegram
 * included), or a link saved from anywhere. Their sign-up when there is nothing else.
 */
export async function lastActiveAt(handle: DbHandle, userId: string): Promise<Date | null> {
  const { users, links, sessions, sessionItems } = handle.schema;

  const [user] = await handle.db
    .select({ seen: users.lastSeenAt, created: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const [saved] = await handle.db
    .select({ at: max(links.savedAt) })
    .from(links)
    .where(eq(links.userId, userId));

  const [answered] = await handle.db
    .select({ at: max(sessionItems.doneAt) })
    .from(sessionItems)
    .innerJoin(sessions, eq(sessions.id, sessionItems.sessionId))
    .where(and(eq(sessions.userId, userId), isNotNull(sessionItems.doneAt)));

  const times = [user.seen, user.created, toDate(saved?.at), toDate(answered?.at)].filter(
    (value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()),
  );
  return times.length ? new Date(Math.max(...times.map((time) => time.getTime()))) : null;
}

/** One slot time per reminder sent after [since], oldest first. */
export async function remindersSentSince(
  handle: DbHandle,
  userId: string,
  since: Date,
): Promise<Date[]> {
  const { notifications } = handle.schema;
  const rows = await handle.db
    .selectDistinct({ slot: notifications.slotTime })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.status, ["sent"]),
        gt(notifications.slotTime, since),
      ),
    )
    .orderBy(desc(notifications.slotTime))
    .limit(50);
  return rows.map((row) => row.slot).reverse();
}

/** max() comes back as a string or a number on some drivers, not a Date. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}
