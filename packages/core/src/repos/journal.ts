// SPDX-License-Identifier: AGPL-3.0-only
// The journal: each day as one entry, with what you read, what you reviewed and what you
// built with coding agents (PRD 29). This is the owner's own view, so it holds
// everything; the public page filters it by the owner's settings (public-building.ts).

import { and, eq, gte } from "drizzle-orm";
import type { Scope } from "./context";
import { listAgentDays, listHighlights, localDay, type AgentDay, type Highlight } from "./agent";

export interface JournalRead {
  id: string;
  url: string;
  title: string | null;
  site: string | null;
  readMinutes: number | null;
  /** The takeaway, when the link is on the public page. */
  takeaway: string | null;
}

export interface JournalDay {
  day: string;
  read: JournalRead[];
  /** Cards answered or acted on that day. */
  reviews: number;
  /** Agent totals for the day, or null with no sessions. */
  building: AgentDay | null;
  highlights: Highlight[];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Every day from [from] (YYYY-MM-DD) with anything in it, newest first. */
export async function loadJournal(scope: Scope, from: string): Promise<JournalDay[]> {
  const { links, reviewLogs, users } = scope.handle.schema;
  const fromDate = new Date(`${from}T00:00:00Z`);
  // A day starts up to 14 hours before UTC midnight somewhere, so read a little earlier
  // and let the local day decide.
  const readFrom = new Date(fromDate.getTime() - 14 * 3_600_000);

  const [userRows, reads, reviews, agentDays, highlights] = await Promise.all([
    scope.handle.db
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, scope.userId))
      .limit(1),
    scope.handle.db
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        siteName: links.siteName,
        readAt: links.readAt,
        readMinutes: links.readMinutes,
        publicTakeaway: links.publicTakeaway,
        sharedAt: links.sharedAt,
      })
      .from(links)
      .where(
        and(eq(links.userId, scope.userId), eq(links.status, "read"), gte(links.readAt, readFrom)),
      ),
    scope.handle.db
      .select({ createdAt: reviewLogs.createdAt })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, scope.userId),
          eq(reviewLogs.undone, false),
          gte(reviewLogs.createdAt, readFrom),
        ),
      ),
    listAgentDays(scope, from),
    listHighlights(scope, { from }),
  ]);
  const timezone = userRows[0]?.timezone ?? "UTC";

  const days = new Map<string, JournalDay>();
  const dayOf = (key: string): JournalDay => {
    let entry = days.get(key);
    if (!entry) {
      entry = { day: key, read: [], reviews: 0, building: null, highlights: [] };
      days.set(key, entry);
    }
    return entry;
  };

  for (const read of reads) {
    if (!read.readAt) continue;
    const key = localDay(read.readAt, timezone);
    if (key < from) continue;
    dayOf(key).read.push({
      id: read.id,
      url: read.url,
      title: read.title,
      site: read.siteName ?? hostOf(read.url),
      readMinutes: read.readMinutes,
      takeaway: read.sharedAt && read.publicTakeaway ? read.publicTakeaway : null,
    });
  }
  for (const review of reviews) {
    const key = localDay(review.createdAt, timezone);
    if (key >= from) dayOf(key).reviews += 1;
  }
  for (const agentDay of agentDays) {
    if (agentDay.sessions > 0) dayOf(agentDay.day).building = agentDay;
  }
  for (const highlight of highlights) dayOf(highlight.day).highlights.push(highlight);

  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}
