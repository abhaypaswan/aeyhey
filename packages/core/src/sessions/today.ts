// SPDX-License-Identifier: AGPL-3.0-only
// The Today screen's numbers (PRD 12.1 screen 2), in one place.
//
// The web page and GET /api/today both read this, so the phone app and the browser can
// never disagree about what is due, when the next reminder is, or how long the streak is.
// Presentation (greetings, copy, layout) stays with each client.

import { dueCounts } from "../repos/cards";
import { linkCounts, listLinks, type LinkCounts } from "../repos/links";
import { listDecks } from "../repos/questions";
import { isPausedIndefinitely, loadSettings, toCadenceSettings } from "../repos/settings";
import { loadStats } from "../repos/stats";
import type { Scope } from "../repos/context";
import { describeNextSession, eligibilityWindow, isPaused } from "../scheduler/cadence";
import { listPushSubscriptions } from "../notify/push";
import { listDevices } from "../notify/devices";

export interface TodayLink {
  id: string;
  url: string;
  title: string | null;
  siteName: string | null;
  summary: string | null;
  status: string;
  readMinutes: number | null;
}

export interface TodayData {
  timezone: string;
  due: { links: number; questions: number; total: number };
  /** How many cards Start session would show right now. */
  sessionSize: number;
  cardsPerSession: number;
  paused: boolean;
  /** Null while paused with no end date, see pausedIndefinitely. */
  pausedUntil: string | null;
  /** Paused until the user turns reminders back on. */
  pausedIndefinitely: boolean;
  /** ISO instant of the next scheduled reminder. */
  nextSessionAt: string;
  /** "Tuesday at 09:00", in the person's timezone. */
  nextSessionLabel: string;
  links: LinkCounts;
  linkTotal: number;
  questionTotal: number;
  questionDeckCount: number;
  totalReviews: number;
  /** Days in a row with at least one review. Today not done yet does not break it. */
  streak: number;
  /** Cards due on each of the next 7 days, soonest first. */
  week: { day: string; count: number }[];
  /** The links most likely to come up next. */
  queue: TodayLink[];
  /** At least one browser or phone will get push reminders. */
  hasPushDevice: boolean;
}

/** Days in a row with at least one review, counting back from today or yesterday. */
export function currentStreak(days: { day: string; count: number }[]): number {
  let index = days.length - 1;
  if (index >= 0 && days[index]?.count === 0) index -= 1;

  let streak = 0;
  while (index >= 0 && (days[index]?.count ?? 0) > 0) {
    streak += 1;
    index -= 1;
  }
  return streak;
}

export async function loadToday(scope: Scope, now = new Date()): Promise<TodayData> {
  const settings = await loadSettings(scope);
  const cadence = toCadenceSettings(settings);
  const window = eligibilityWindow(now, cadence);

  const [counts, links, decks, stats, queue, webPush, phones] = await Promise.all([
    dueCounts(scope, window.until),
    linkCounts(scope),
    listDecks(scope, now),
    loadStats(scope, now),
    listLinks(scope, { status: ["unread", "expiring"], limit: 4 }),
    listPushSubscriptions(scope.handle, scope.userId),
    listDevices(scope.handle, scope.userId),
  ]);

  const dueTotal = counts.questionsDue + counts.linksDue;
  const questionDecks = decks.filter((deck) => deck.kind !== "links");
  const paused = isPaused(now, cadence);

  return {
    timezone: settings.timezone,
    due: { links: counts.linksDue, questions: counts.questionsDue, total: dueTotal },
    sessionSize: Math.min(settings.cardsPerSession, dueTotal),
    cardsPerSession: settings.cardsPerSession,
    paused,
    pausedUntil:
      paused && settings.pausedUntil && !isPausedIndefinitely(settings.pausedUntil)
        ? settings.pausedUntil.toISOString()
        : null,
    pausedIndefinitely: paused && isPausedIndefinitely(settings.pausedUntil),
    nextSessionAt: window.nextSessionAt.toISOString(),
    nextSessionLabel: describeNextSession(now, cadence),
    links,
    linkTotal: Object.values(links).reduce((sum, value) => sum + value, 0),
    questionTotal: questionDecks.reduce((sum, deck) => sum + deck.counts.total, 0),
    questionDeckCount: questionDecks.length,
    totalReviews: stats.totalReviews,
    streak: currentStreak(stats.reviewsPerDay),
    week: stats.duePerDay.slice(0, 7),
    queue: queue.items.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title ?? null,
      siteName: item.siteName ?? null,
      summary: item.summaryLines?.[0] ?? null,
      status: item.status,
      readMinutes: item.readMinutes ?? null,
    })),
    hasPushDevice: webPush.length + phones.length > 0,
  };
}
