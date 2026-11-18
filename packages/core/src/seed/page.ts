// SPDX-License-Identifier: AGPL-3.0-only
// The demo's public page: set up and public, a few read links with what was taken from
// each, a week of coding sessions, and highlights from them, some kept and two still
// drafts. So Your page shows everything it can on a fresh demo: the page as a visitor
// sees it, and the lines still to review above it.

import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { newId } from "../ids";
import type { Scope } from "../repos/context";
import { recountDay, saveSignal, todayFor } from "../repos/agent";
import { savePublicProfile } from "../repos/public-page";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read links in the demo library, by address, and the line taken from each. */
export const SEED_TAKEAWAYS: { url: string; takeaway: string }[] = [
  {
    url: "https://danluu.com/percentile-latency/",
    takeaway:
      "Averages hide the slow requests people actually feel. Watch p99, and remember one page load makes many requests, so most users meet the tail.",
  },
  {
    url: "https://kafka.apache.org/documentation/#design",
    takeaway:
      "Kafka is a log first: order holds only within a partition, so the partition key decides what stays in order.",
  },
  {
    url: "https://jalammar.github.io/illustrated-transformer/",
    takeaway:
      "Attention is a weighted lookup: each word asks a question (query), every word offers a label (key), and the answer is a blend of their values.",
  },
  {
    url: "https://ncase.me/remember/",
    takeaway:
      "Forgetting is the signal. Reviewing just as something starts to fade is what makes the gaps between reviews grow.",
  },
  {
    url: "https://dataintensive.net/",
    takeaway:
      "Replication and partitioning are separate choices. Most of the hard bugs live where they meet.",
  },
];

/** A week of sessions on one repo: days back, session length in minutes. */
const SEED_SESSIONS: { daysAgo: number; minutes: number; repo: string }[] = [
  { daysAgo: 6, minutes: 95, repo: "aeyhey" },
  { daysAgo: 5, minutes: 40, repo: "aeyhey" },
  { daysAgo: 3, minutes: 130, repo: "aeyhey" },
  { daysAgo: 2, minutes: 70, repo: "notes-cli" },
  { daysAgo: 1, minutes: 55, repo: "aeyhey" },
  { daysAgo: 0, minutes: 45, repo: "aeyhey" },
];

const SEED_HIGHLIGHTS: {
  daysAgo: number;
  text: string;
  kind: "shipped" | "progress" | "learned";
  status: "kept" | "draft";
  repo: string;
}[] = [
  {
    daysAgo: 6,
    text: "Shipped the knowledge map: links and questions clustered by shared tags.",
    kind: "shipped",
    status: "kept",
    repo: "aeyhey",
  },
  {
    daysAgo: 5,
    text: "Postgres and SQLite read JSON differently, so the job dedupe key now has one helper per dialect.",
    kind: "learned",
    status: "kept",
    repo: "aeyhey",
  },
  {
    daysAgo: 3,
    text: "Moving every add form into one assistant that reads what you paste.",
    kind: "progress",
    status: "kept",
    repo: "aeyhey",
  },
  {
    daysAgo: 2,
    text: "Shipped full-text search over notes with SQLite FTS5.",
    kind: "shipped",
    status: "kept",
    repo: "notes-cli",
  },
  {
    daysAgo: 1,
    text: "Decks now live on Home instead of their own tab.",
    kind: "shipped",
    status: "draft",
    repo: "aeyhey",
  },
  {
    daysAgo: 0,
    text: "Your page now shows the page as visitors see it, with drafts to review above it.",
    kind: "progress",
    status: "draft",
    repo: "aeyhey",
  },
];

export async function seedDemoPage(handle: DbHandle, scope: Scope, now: Date): Promise<void> {
  const { links, agentHighlights } = handle.schema;

  await savePublicProfile(scope, {
    handle: "demo",
    enabled: true,
    indexable: false,
    showStats: true,
    buildingVisibility: "highlights",
    bio: "Backend engineer, reading about distributed systems and how memory works.",
    headline: "Backend engineer",
    location: "Bengaluru",
    links: [{ label: "GitHub", url: "https://github.com/example" }],
    skills: ["Go", "Postgres", "Kafka", "TypeScript"],
    interests: ["Distributed systems", "Learning science"],
  });

  // Shared on the day each was read, so the takeaways spread over the feed.
  for (const { url, takeaway } of SEED_TAKEAWAYS) {
    const rows = await handle.db
      .select({ id: links.id, readAt: links.readAt })
      .from(links)
      .where(and(eq(links.userId, scope.userId), eq(links.url, url), eq(links.status, "read")))
      .limit(1);
    const row = rows[0];
    if (!row) continue;
    await handle.db
      .update(links)
      .set({ sharedAt: row.readAt ?? now, publicTakeaway: takeaway })
      .where(and(eq(links.userId, scope.userId), eq(links.id, row.id)));
  }

  const days = new Set<string>();
  for (const [index, session] of SEED_SESSIONS.entries()) {
    // Sessions end an hour before now, so today's never lands in the future.
    const endedAt = new Date(now.getTime() - session.daysAgo * DAY_MS - 60 * 60 * 1000);
    const startedAt = new Date(endedAt.getTime() - session.minutes * 60 * 1000);
    await saveSignal(scope, {
      sessionId: `demo-session-${index}`,
      tool: index % 3 === 2 ? "codex" : "claude-code",
      repo: session.repo,
      startedAt,
      endedAt,
      tokens: { input: session.minutes * 4_000, output: session.minutes * 900 },
      filesChanged: Math.round(session.minutes / 8),
      details: { linesAdded: session.minutes * 6, linesRemoved: session.minutes * 2 },
    });
    days.add(await todayFor(handle, scope.userId, endedAt));
  }
  for (const day of days) await recountDay(scope, day);

  for (const highlight of SEED_HIGHLIGHTS) {
    const at = new Date(now.getTime() - highlight.daysAgo * DAY_MS - 60 * 60 * 1000);
    await handle.db.insert(agentHighlights).values({
      id: newId(at),
      userId: scope.userId,
      day: await todayFor(handle, scope.userId, at),
      text: highlight.text,
      kind: highlight.kind,
      status: highlight.status,
      repo: highlight.repo,
      createdAt: at,
      updatedAt: at,
    });
  }
}
