// SPDX-License-Identifier: AGPL-3.0-only
// The numbers on a public page (PRD 28): how long and how steadily someone has been
// reading, and what about.
//
// Only reading is public. Question decks, answers and scores never appear here, because
// they can say more than a person meant to share (that they are preparing for interviews,
// say, or where they are weak). Review activity is used only as "a day you showed up",
// with no detail. Topics and sources come only from links the person already shared.

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Scope } from "./context";

const DAY_MS = 86_400_000;

/**
 * How many days the activity grid covers: 52 weeks, a year, like a contribution graph.
 * Phones show the last 13 weeks of it.
 */
export const ACTIVITY_DAYS = 364;

export interface Milestone {
  kind: "streak" | "links" | "takeaways" | "hours" | "days";
  /** The tier reached, for example 30 for a 30-day streak. */
  value: number;
  /** Written for the page: "30-day streak". */
  label: string;
  /** When it was first reached, as YYYY-MM-DD in UTC. Null if it cannot be told. */
  reachedOn?: string | null;
}

export interface PublicStats {
  /** When they started: the first thing they read or reviewed, or when they signed up. */
  since: string;
  daysActive: number;
  currentStreak: number;
  longestStreak: number;
  linksRead: number;
  takeaways: number;
  /** From each read link's reading time. Rounded down to whole hours on the page. */
  minutesRead: number;
  /** Activity per day for the last ACTIVITY_DAYS days, oldest first, ending today (UTC). */
  activity: { start: string; counts: number[] };
  topics: { name: string; count: number }[];
  sources: { name: string; count: number }[];
  /** The best tier reached of each kind, most impressive first. */
  milestones: Milestone[];
  /** The first day of the current streak, YYYY-MM-DD, or null with no streak. */
  streakStart: string | null;
  /** Growth over the last 30 days, for the "+38 in 30 days" lines. */
  recent: { links: number; minutes: number; days: number; takeaways: number };
}

const TIERS: Record<Milestone["kind"], number[]> = {
  streak: [7, 14, 30, 60, 100, 200, 365],
  links: [10, 25, 50, 100, 250, 500, 1000],
  takeaways: [5, 10, 25, 50, 100, 250],
  hours: [5, 10, 25, 50, 100, 250],
  days: [30, 60, 100, 200, 365, 730],
};

function label(kind: Milestone["kind"], value: number): string {
  switch (kind) {
    case "streak":
      return `${value}-day streak`;
    case "links":
      return `${value} links read`;
    case "takeaways":
      return `${value} takeaways shared`;
    case "hours":
      return `${value} hours of reading`;
    case "days":
      return `${value} days of reading`;
  }
}

/** The best tier reached for each kind, ordered by how far up its ladder it is. */
export function milestonesFor(stats: {
  longestStreak: number;
  linksRead: number;
  takeaways: number;
  minutesRead: number;
  daysActive: number;
}): Milestone[] {
  const reached: { kind: Milestone["kind"]; value: number; rank: number }[] = [];
  const amounts: Record<Milestone["kind"], number> = {
    streak: stats.longestStreak,
    links: stats.linksRead,
    takeaways: stats.takeaways,
    hours: Math.floor(stats.minutesRead / 60),
    days: stats.daysActive,
  };
  for (const kind of Object.keys(TIERS) as Milestone["kind"][]) {
    const tiers = TIERS[kind];
    let rank = -1;
    for (let i = 0; i < tiers.length; i += 1) if (amounts[kind] >= tiers[i]!) rank = i;
    if (rank >= 0) reached.push({ kind, value: tiers[rank]!, rank: rank / (tiers.length - 1) });
  }
  return reached
    .sort((a, b) => b.rank - a.rank)
    .map(({ kind, value }) => ({ kind, value, label: label(kind, value) }));
}

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** Longest run of consecutive day keys, and the run that ends today or yesterday. */
export function streaks(days: Set<string>, now = new Date()): { current: number; longest: number } {
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of sorted) {
    const at = Date.parse(`${key}T00:00:00Z`);
    run = previous !== null && at - previous === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = at;
  }

  let current = 0;
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  // A streak still counts until a whole day is missed: today may simply not have
  // started yet.
  let cursor = days.has(dayKey(new Date(today))) ? today : today - DAY_MS;
  while (days.has(dayKey(new Date(cursor)))) {
    current += 1;
    cursor -= DAY_MS;
  }
  return { current, longest };
}

/**
 * [extraDays] are more days to count as "showed up", with how much each adds to the
 * activity grid, such as days of agent work when
 * the owner made that public (PRD 29.3). Left out, only reading and reviews count.
 */
export async function loadPublicStats(
  scope: Scope,
  now = new Date(),
  extraDays?: ReadonlyMap<string, number>,
): Promise<PublicStats> {
  const { reviewLogs, links, itemTags, tags, users } = scope.handle.schema;

  const [reviews, reads, user] = await Promise.all([
    scope.handle.db
      .select({ createdAt: reviewLogs.createdAt })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, scope.userId), eq(reviewLogs.undone, false))),
    scope.handle.db
      .select({
        id: links.id,
        url: links.url,
        siteName: links.siteName,
        readAt: links.readAt,
        readMinutes: links.readMinutes,
        sharedAt: links.sharedAt,
        publicTakeaway: links.publicTakeaway,
      })
      .from(links)
      .where(and(eq(links.userId, scope.userId), eq(links.status, "read"))),
    scope.handle.db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, scope.userId))
      .limit(1),
  ]);

  // Every day with anything in it: a review, a read, or a takeaway shared.
  const perDay = new Map<string, number>();
  const bump = (date: Date | null) => {
    if (!date) return;
    const key = dayKey(date);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  };
  for (const review of reviews) bump(review.createdAt);
  for (const read of reads) {
    bump(read.readAt);
    if (read.sharedAt && read.publicTakeaway) bump(read.sharedAt);
  }
  // One activity: a day of building counts like a day of reading, more for a longer one.
  for (const [key, weight] of extraDays ?? []) perDay.set(key, (perDay.get(key) ?? 0) + weight);

  const days = new Set(perDay.keys());
  const { current, longest } = streaks(days, now);

  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const start = today - (ACTIVITY_DAYS - 1) * DAY_MS;
  const counts: number[] = [];
  for (let i = 0; i < ACTIVITY_DAYS; i += 1) {
    counts.push(perDay.get(dayKey(new Date(start + i * DAY_MS))) ?? 0);
  }

  const shared = reads.filter((read) => read.sharedAt && read.publicTakeaway);

  const sourceCounts = new Map<string, number>();
  for (const link of shared) {
    let name = link.siteName;
    if (!name) {
      try {
        name = new URL(link.url).hostname.replace(/^www\./, "");
      } catch {
        name = null;
      }
    }
    if (name) sourceCounts.set(name, (sourceCounts.get(name) ?? 0) + 1);
  }

  const topicCounts = new Map<string, number>();
  if (shared.length > 0) {
    const rows = await scope.handle.db
      .select({ name: tags.name, itemId: itemTags.itemId })
      .from(itemTags)
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(
        and(
          eq(itemTags.userId, scope.userId),
          eq(itemTags.itemType, "link"),
          inArray(
            itemTags.itemId,
            shared.map((link) => link.id),
          ),
          isNotNull(tags.name),
        ),
      );
    for (const row of rows) topicCounts.set(row.name, (topicCounts.get(row.name) ?? 0) + 1);
  }

  const top = (map: Map<string, number>, n: number) =>
    [...map]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  const firstDay = [...days].sort()[0];
  const joined = user[0]?.createdAt ?? now;
  const since =
    firstDay && Date.parse(`${firstDay}T00:00:00Z`) < joined.getTime()
      ? `${firstDay}T00:00:00.000Z`
      : joined.toISOString();

  const totals = {
    daysActive: days.size,
    currentStreak: current,
    longestStreak: longest,
    linksRead: reads.length,
    takeaways: shared.length,
    minutesRead: reads.reduce((sum, read) => sum + (read.readMinutes ?? 0), 0),
  };

  // Each kind's history in order, to tell when a milestone was first reached.
  const readDays = reads
    .map((read) => read.readAt)
    .filter((when): when is Date => when !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const shareDays = shared.map((link) => link.sharedAt!).sort((a, b) => a.getTime() - b.getTime());
  const activeDays = [...days].sort();
  const reachedOn = (kind: Milestone["kind"], value: number): string | null => {
    switch (kind) {
      case "links":
        return readDays[value - 1] ? dayKey(readDays[value - 1]!) : null;
      case "takeaways":
        return shareDays[value - 1] ? dayKey(shareDays[value - 1]!) : null;
      case "days":
        return activeDays[value - 1] ?? null;
      case "hours": {
        let minutes = 0;
        const timed = reads
          .filter((read) => read.readAt)
          .sort((a, b) => a.readAt!.getTime() - b.readAt!.getTime());
        for (const read of timed) {
          minutes += read.readMinutes ?? 0;
          if (minutes >= value * 60) return dayKey(read.readAt!);
        }
        return null;
      }
      case "streak": {
        let run = 0;
        let previous: number | null = null;
        for (const key of activeDays) {
          const at = Date.parse(`${key}T00:00:00Z`);
          run = previous !== null && at - previous === DAY_MS ? run + 1 : 1;
          if (run === value) return key;
          previous = at;
        }
        return null;
      }
    }
  };

  const monthAgo = now.getTime() - 30 * DAY_MS;
  const recentKeys = activeDays.filter(
    (key) => Date.parse(`${key}T00:00:00Z`) >= monthAgo - DAY_MS,
  );
  const recentReads = reads.filter((read) => read.readAt && read.readAt.getTime() >= monthAgo);

  return {
    since,
    ...totals,
    activity: { start: dayKey(new Date(start)), counts },
    topics: top(topicCounts, 10),
    sources: top(sourceCounts, 6),
    milestones: milestonesFor(totals).map((milestone) => ({
      ...milestone,
      reachedOn: reachedOn(milestone.kind, milestone.value),
    })),
    streakStart:
      current > 0
        ? dayKey(
            new Date((days.has(dayKey(now)) ? today : today - DAY_MS) - (current - 1) * DAY_MS),
          )
        : null,
    recent: {
      links: recentReads.length,
      minutes: recentReads.reduce((sum, read) => sum + (read.readMinutes ?? 0), 0),
      days: recentKeys.length,
      takeaways: shareDays.filter((when) => when.getTime() >= monthAgo).length,
    },
  };
}
