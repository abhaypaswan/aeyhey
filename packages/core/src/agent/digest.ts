// SPDX-License-Identifier: AGPL-3.0-only
// The daily digest (PRD 29.2): a day of coding agent sessions in, a few highlights out.
//
// Most of the work is done before any model sees it. Sessions are grouped by goal (the
// repo and branch they ran in), trivial ones are dropped, and only what is left goes to
// one AI call per person per day. A day with nothing worth keeping costs nothing.

import { callAi, type AiCallDeps } from "../ai/call";
import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "../ai/prompts/shared";
import type { DbHandle } from "../db/client";
import { enqueue } from "../jobs/queue";
import { scopeFor, type Scope } from "../repos/context";
import {
  listHighlights,
  markDayDigested,
  purgeOldSignals,
  replaceDrafts,
  signalsForDay,
  undigestedDays,
  type SignalForDigest,
} from "../repos/agent";
import { createLogger } from "../logger";

const log = createLogger("agent-digest");

export const DIGEST_JOB = "digest_agent_day" as const;

/** A session shorter than this, that changed nothing, is a quick question. */
export const TRIVIAL_MINUTES = 5;

export interface DigestGoal {
  repo: string | null;
  branch: string | null;
  sessions: number;
  minutes: number;
  filesChanged: number;
  commits: string[];
  /** Session titles, when the person opted in to sending them. */
  titles: string[];
  linesAdded: number;
  linesRemoved: number;
  /** File extensions changed, most first. */
  languages: string[];
}

/**
 * Groups a day's sessions by goal and drops the trivial ones. Pure, so the filter is
 * easy to test: forty sessions on one branch are one goal, and a two minute question
 * with no changes is nothing. Work outside a repo, such as research, is told apart by
 * its title when there is one.
 */
export function planDigest(signals: readonly SignalForDigest[]): DigestGoal[] {
  const groups = new Map<string, DigestGoal & { languageCounts: Record<string, number> }>();
  for (const s of signals) {
    const changed = s.filesChanged > 0 || s.commits.length > 0 || (s.linesAdded ?? 0) > 0;
    if (s.minutes < TRIVIAL_MINUTES && !changed) continue;
    const key = s.repo ? `${s.repo}\u0000${s.branch ?? ""}` : `\u0000${s.title ?? ""}`;
    const goal = groups.get(key) ?? {
      repo: s.repo,
      branch: s.branch,
      sessions: 0,
      minutes: 0,
      filesChanged: 0,
      commits: [],
      titles: [],
      linesAdded: 0,
      linesRemoved: 0,
      languages: [],
      languageCounts: {},
    };
    goal.sessions += 1;
    goal.minutes += s.minutes;
    goal.filesChanged += s.filesChanged;
    goal.linesAdded += s.linesAdded ?? 0;
    goal.linesRemoved += s.linesRemoved ?? 0;
    for (const commit of s.commits) if (!goal.commits.includes(commit)) goal.commits.push(commit);
    if (s.title && !goal.titles.includes(s.title)) goal.titles.push(s.title);
    for (const [ext, files] of Object.entries(s.languages ?? {})) {
      goal.languageCounts[ext] = (goal.languageCounts[ext] ?? 0) + files;
    }
    groups.set(key, goal);
  }
  // The biggest goals first: the model is asked for at most five lines.
  return [...groups.values()]
    .map(({ languageCounts, ...goal }) => ({
      ...goal,
      languages: Object.entries(languageCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([ext]) => ext)
        .slice(0, 5),
    }))
    .sort((a, b) => b.commits.length - a.commits.length || b.minutes - a.minutes);
}

export const AGENT_DIGEST_SYSTEM = joinPrompt(
  "You write one person's daily standup from a day of their coding agent sessions. Someone who reads it, a teammate or a hiring manager, should understand what was done, why it mattered, and what is still going.",
  "You get the day's goals: each is a repo and branch (or none, for work outside a repo) with time spent, files and lines changed, the languages touched, the commit messages made, and sometimes session titles.",
  "Write at most six notes for the whole day, one per real goal or outcome, never one per session or per commit. Merge goals that are clearly the same piece of work. Leave out anything small: a tiny fix, a version bump, formatting.",
  'Each note is one or two full sentences, at most 40 words, in the past tense, without "I". Say what changed in plain terms, then why it matters or what it made possible, with a concrete detail from the commits when there is one. Good: "Added a pause option to decks, so a deck can rest without being deleted; paused decks stay out of reviews and stop getting new questions." Bad: "Worked on decks."',
  'kind is "shipped" for work finished that day, "progress" for work still going (say what is left when the commits make it clear), and "learned" for a lesson, finding or decision the commits or titles make clear. Do not invent anything the input does not support.',
  "Set repo to the goal's repo name, or null.",
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

export function buildAgentDigestPrompt(input: {
  day: string;
  goals: readonly DigestGoal[];
  pinned: readonly string[];
}): string {
  const goals = input.goals.slice(0, 12).map((goal) => ({
    repo: goal.repo,
    branch: goal.branch,
    sessions: goal.sessions,
    minutes: goal.minutes,
    filesChanged: goal.filesChanged,
    linesAdded: goal.linesAdded,
    linesRemoved: goal.linesRemoved,
    languages: goal.languages,
    titles: goal.titles.slice(0, 10),
    commits: goal.commits.slice(0, 15),
  }));
  return joinPrompt(
    `The day: ${input.day}.`,
    // The marker lines let the mock provider read the goals back in demo mode.
    `The goals, as JSON:\n${untrusted("work", `GOALS_JSON\n${JSON.stringify(goals)}\nEND_GOALS_JSON`, 12_000)}`,
    input.pinned.length > 0
      ? `Lines the person already pinned for this day. Do not repeat them:\n${untrusted("note", input.pinned.join("\n"), 2_000)}`
      : null,
  );
}

/**
 * Digests one day: drafts highlights from its signals, replacing earlier drafts, and
 * marks the signals digested. Kept, dropped and pinned lines are left alone. Returns the
 * number of drafts written.
 */
export async function digestDay(
  deps: AiCallDeps,
  scope: Scope,
  day: string,
  jobId?: string,
): Promise<number> {
  const goals = planDigest(await signalsForDay(scope, day));
  const existing = await listHighlights(scope, { from: day, to: day, includeDropped: true });
  const pinned = existing.filter((h) => h.kind === "pinned").map((h) => h.text);

  let drafts: { text: string; kind: "shipped" | "progress" | "learned"; repo: string | null }[] =
    [];
  if (goals.length > 0) {
    const result = await callAi(deps, {
      contract: "agent_digest",
      userId: scope.userId,
      system: AGENT_DIGEST_SYSTEM,
      prompt: buildAgentDigestPrompt({ day, goals, pinned }),
      ...(jobId ? { jobId } : {}),
    });
    // A line the person already kept or dropped for this day is not drafted again.
    const decided = new Set(
      existing.filter((h) => h.status !== "draft").map((h) => h.text.toLowerCase()),
    );
    drafts = result.object.highlights
      .filter((h) => !decided.has(h.text.toLowerCase()))
      .map((h) => ({ text: h.text, kind: h.kind, repo: h.repo ?? null }));
  }

  await replaceDrafts(scope, day, drafts);
  await markDayDigested(scope, day);
  log.info("digested a day", {
    userId: scope.userId,
    day,
    goals: goals.length,
    drafts: drafts.length,
  });
  return drafts.length;
}

export function digestKey(userId: string, day: string): string {
  return `digest:${userId}:${day}`;
}

/**
 * Runs every minute in the worker: queues a digest for each finished day that has
 * signals not yet digested, and clears out old signals.
 */
export async function queueDigests(options: { handle: DbHandle; now?: Date }): Promise<number> {
  const { handle } = options;
  const now = options.now ?? new Date();
  const days = await undigestedDays(handle, now);
  for (const { userId, day } of days) {
    await enqueue(handle, {
      type: DIGEST_JOB,
      userId,
      payload: { day },
      dedupeKey: digestKey(userId, day),
    });
  }
  const purged = await purgeOldSignals(handle, now);
  if (days.length > 0 || purged > 0) log.info("agent digests", { queued: days.length, purged });
  return days.length;
}

/** The job: digest the day in its payload. */
export async function digestJob(deps: AiCallDeps, handle: DbHandle, userId: string, day: string) {
  return digestDay(deps, scopeFor(handle, userId), day);
}
