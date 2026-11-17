// SPDX-License-Identifier: AGPL-3.0-only
// The stats page's data (PRD 12.1 screen 12).
//
// All of it comes from the user's own tables. Aeyhey has no telemetry, and this is the
// reason it does not need any: review_logs and ai_usage already hold everything worth
// showing, and neither leaves the machine.
//
// Lives here rather than in the page so apps/web needs no database library of its own.

import { and, eq, gte, sql } from "drizzle-orm";
import type { Scope } from "./context";
import { linkCounts, type LinkCounts } from "./links";

const DAY_MS = 86_400_000;

export interface StatsBundle {
  /** One entry per day for the last 30, zero-filled, oldest first. */
  reviewsPerDay: { day: string; count: number }[];
  /** One entry per day for the next 30, zero-filled, soonest first. Overdue counts as today. */
  duePerDay: { day: string; count: number }[];
  usage: { task: string; calls: number; inputTokens: number; outputTokens: number }[];
  links: LinkCounts;
  /** Reviews in the last 30 days, the same window as reviewsPerDay. */
  totalReviews: number;
  averageScore: number | null;
  /** Average score per tag, so the user can see where they are weak. */
  scoreByTag: { tag: string; averageScore: number; answers: number }[];
}

export async function loadStats(scope: Scope, now = new Date()): Promise<StatsBundle> {
  const { reviewLogs, aiUsage, cards, grades, questions, itemTags, tags } = scope.handle.schema;
  const since = new Date(now.getTime() - 30 * DAY_MS);

  const [reviews, usage, upcoming, scores, links, tagScores] = await Promise.all([
    scope.handle.db
      .select({ createdAt: reviewLogs.createdAt })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, scope.userId),
          eq(reviewLogs.undone, false),
          gte(reviewLogs.createdAt, since),
        ),
      ),

    scope.handle.db
      .select({
        task: aiUsage.task,
        calls: sql<number>`count(*)`.as("calls"),
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)`.as("inputTokens"),
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)`.as("outputTokens"),
      })
      .from(aiUsage)
      .where(eq(aiUsage.userId, scope.userId))
      .groupBy(aiUsage.task),

    scope.handle.db
      .select({ due: cards.due, status: cards.status })
      .from(cards)
      .where(eq(cards.userId, scope.userId)),

    scope.handle.db
      .select({ score: grades.score })
      .from(grades)
      .where(eq(grades.userId, scope.userId)),

    linkCounts(scope),

    // Score by tag, joined through the question each grade belongs to.
    scope.handle.db
      .select({
        tag: tags.name,
        averageScore: sql<number>`avg(${grades.score})`.as("averageScore"),
        answers: sql<number>`count(*)`.as("answers"),
      })
      .from(grades)
      .innerJoin(questions, eq(questions.id, grades.questionId))
      .innerJoin(
        itemTags,
        and(eq(itemTags.itemType, "question"), eq(itemTags.itemId, questions.id)),
      )
      .innerJoin(tags, eq(tags.id, itemTags.tagId))
      .where(eq(grades.userId, scope.userId))
      .groupBy(tags.name),
  ]);

  // Zero-filled buckets, so a quiet day is a gap in the chart rather than a missing bar.
  const reviewBuckets = new Map<string, number>();
  for (let i = 29; i >= 0; i -= 1) {
    reviewBuckets.set(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const review of reviews) {
    const key = review.createdAt.toISOString().slice(0, 10);
    if (reviewBuckets.has(key)) reviewBuckets.set(key, (reviewBuckets.get(key) ?? 0) + 1);
  }

  const dueBuckets = new Map<string, number>();
  for (let i = 0; i < 30; i += 1) {
    dueBuckets.set(new Date(now.getTime() + i * DAY_MS).toISOString().slice(0, 10), 0);
  }
  const notScheduled = ["deleted", "suspended", "read", "dropped", "expired"];
  const today = now.toISOString().slice(0, 10);
  for (const card of upcoming) {
    if (notScheduled.includes(card.status)) continue;
    // Overdue cards are due now, so they count towards today rather than vanishing.
    const key = card.due.getTime() < now.getTime() ? today : card.due.toISOString().slice(0, 10);
    if (dueBuckets.has(key)) dueBuckets.set(key, (dueBuckets.get(key) ?? 0) + 1);
  }

  return {
    reviewsPerDay: [...reviewBuckets].map(([day, count]) => ({ day, count })),
    duePerDay: [...dueBuckets].map(([day, count]) => ({ day, count })),
    usage: usage.map((row) => ({
      task: row.task,
      calls: Number(row.calls),
      inputTokens: Number(row.inputTokens ?? 0),
      outputTokens: Number(row.outputTokens ?? 0),
    })),
    links,
    totalReviews: reviews.length,
    averageScore:
      scores.length > 0
        ? Math.round(scores.reduce((sum, row) => sum + row.score, 0) / scores.length)
        : null,
    scoreByTag: tagScores
      .map((row) => ({
        tag: row.tag,
        averageScore: Math.round(Number(row.averageScore)),
        answers: Number(row.answers),
      }))
      // Weakest first: that is the useful order.
      .sort((a, b) => a.averageScore - b.averageScore),
  };
}
