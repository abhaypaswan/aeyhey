// SPDX-License-Identifier: AGPL-3.0-only
// Coding agent sessions and the daily highlights made from them (PRD 29).
//
// A finished session arrives as a signal: numbers, names and commit messages, nothing
// else. Signals are private and short lived. Each one updates its day's totals, which
// are kept after the signals are gone. Once a day is over, the digest job reads its
// signals and drafts a few highlights for the person to keep or drop.

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { AgentModelUsage, AgentSessionDetails } from "../db/types";
import { newId } from "../ids";
import type { Scope } from "./context";

export const HIGHLIGHT_KINDS = ["shipped", "progress", "learned", "pinned"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

export const HIGHLIGHT_STATUSES = ["draft", "kept", "dropped"] as const;
export type HighlightStatus = (typeof HIGHLIGHT_STATUSES)[number];

/** Signals are deleted this long after their day was digested (PRD 29.2). */
export const SIGNAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_COMMITS = 30;
export const MAX_COMMIT_CHARS = 200;

// ---------------------------------------------------------------- days

/** YYYY-MM-DD for [when] in [timezone]. Falls back to UTC for an unknown zone. */
export function localDay(when: Date, timezone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(when);
  try {
    return format(timezone);
  } catch {
    return format("UTC");
  }
}

async function timezoneOf(handle: DbHandle, userId: string): Promise<string> {
  const { users } = handle.schema;
  const rows = await handle.db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.timezone ?? "UTC";
}

export async function todayFor(handle: DbHandle, userId: string, now = new Date()) {
  return localDay(now, await timezoneOf(handle, userId));
}

/**
 * Minutes covered by at least one of [intervals]: three sessions in the same hour are
 * one hour. Pure, so the overlap maths is easy to test.
 */
export function unionMinutes(intervals: readonly { start: Date; end: Date }[]): number {
  const sorted = intervals
    .map((i) => [i.start.getTime(), Math.max(i.start.getTime(), i.end.getTime())] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else if (end > current[1]) {
      current[1] = end;
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total / 60_000);
}

// ---------------------------------------------------------------- secrets

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, // OpenAI and Anthropic style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bahy_[A-Za-z0-9_-]{16,}/g, // Aeyhey's own tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/g, // credentials in a URL
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi,
];

/** Replaces anything that looks like a secret with [hidden] (PRD 29.4 FR-AG-5). */
export function hideSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[hidden]");
  return out;
}

/** Commit messages as stored: secrets hidden, one line each, clamped, at most 30. */
export function tidyCommits(commits: readonly string[]): string[] {
  return commits
    .map((message) => hideSecrets(message).replace(/\s+/g, " ").trim().slice(0, MAX_COMMIT_CHARS))
    .filter((message) => message.length > 0)
    .slice(0, MAX_COMMITS);
}

// ---------------------------------------------------------------- signals

export interface SignalInput {
  sessionId: string;
  tool: string;
  repo?: string | null;
  branch?: string | null;
  startedAt: Date;
  endedAt: Date;
  tokens?: { input?: number; output?: number; cache?: number };
  filesChanged?: number;
  commits?: readonly string[];
  details?: AgentSessionDetails;
}

// ---------------------------------------------------------------- details

const COUNT_FIELDS = [
  "prompts",
  "turns",
  "toolErrors",
  "apiErrors",
  "compactions",
  "subagentTurns",
  "linesAdded",
  "linesRemoved",
  "busyMinutes",
  "thinkingSeconds",
  "apiSeconds",
  "toolSeconds",
  "costUsd",
] as const satisfies readonly (keyof AgentSessionDetails)[];

const COUNT_MAPS = [
  "toolCalls",
  "skills",
  "plugins",
  "mcpServers",
  "modes",
  "effort",
  "serverTools",
  "languages",
] as const satisfies readonly (keyof AgentSessionDetails)[];

/** Details as stored: secrets out of the title, negative or broken numbers dropped. */
export function tidyDetails(details: AgentSessionDetails | undefined): AgentSessionDetails {
  if (!details) return {};
  const out: AgentSessionDetails = { ...details };
  if (out.title !== undefined) {
    const title = hideSecrets(out.title).replace(/\s+/g, " ").trim().slice(0, 120);
    if (title) out.title = title;
    else delete out.title;
  }
  for (const field of COUNT_FIELDS) {
    const value = out[field];
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) delete out[field];
  }
  return out;
}

function addMaps(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!a && !b) return undefined;
  const out = { ...(a ?? {}) };
  for (const [key, value] of Object.entries(b ?? {})) out[key] = (out[key] ?? 0) + value;
  return out;
}

/**
 * Adds two sessions' details: counts and maps are summed, models per field. The client
 * and end reason are per session, so the day keeps the latest; titles are not kept on
 * the day at all.
 */
export function addDetails(a: AgentSessionDetails, b: AgentSessionDetails): AgentSessionDetails {
  const out: AgentSessionDetails = {};
  for (const field of COUNT_FIELDS) {
    if (a[field] !== undefined || b[field] !== undefined) {
      const sum = (a[field] ?? 0) + (b[field] ?? 0);
      out[field] = field === "costUsd" ? Math.round(sum * 10_000) / 10_000 : sum;
    }
  }
  for (const field of COUNT_MAPS) {
    const merged = addMaps(a[field], b[field]);
    if (merged) out[field] = merged;
  }
  if (a.models || b.models) {
    const models: Record<string, AgentModelUsage> = {};
    for (const source of [a.models ?? {}, b.models ?? {}]) {
      for (const [name, usage] of Object.entries(source)) {
        const current = models[name] ?? { input: 0, output: 0, cache: 0, messages: 0 };
        models[name] = {
          input: current.input + usage.input,
          output: current.output + usage.output,
          cache: current.cache + usage.cache,
          messages: current.messages + usage.messages,
        };
      }
    }
    out.models = models;
  }
  const client = b.client ?? a.client;
  if (client) out.client = client;
  return out;
}

/**
 * Stores a finished session, or updates it when the same session is reported again (a
 * resumed session ends twice). Recounts the day it lands on. Returns that day.
 */
export async function saveSignal(scope: Scope, input: SignalInput): Promise<string> {
  const { agentSignals } = scope.handle.schema;
  const endedAt = input.endedAt < input.startedAt ? input.startedAt : input.endedAt;
  const day = localDay(endedAt, await timezoneOf(scope.handle, scope.userId));
  const row = {
    repo: input.repo ?? null,
    branch: input.branch ?? null,
    startedAt: input.startedAt,
    endedAt,
    day,
    inputTokens: Math.max(0, Math.round(input.tokens?.input ?? 0)),
    outputTokens: Math.max(0, Math.round(input.tokens?.output ?? 0)),
    cacheTokens: Math.max(0, Math.round(input.tokens?.cache ?? 0)),
    filesChanged: Math.max(0, Math.round(input.filesChanged ?? 0)),
    commits: tidyCommits(input.commits ?? []),
    details: tidyDetails(input.details),
  };

  const existing = await scope.handle.db
    .select({ id: agentSignals.id, day: agentSignals.day })
    .from(agentSignals)
    .where(
      and(
        eq(agentSignals.userId, scope.userId),
        eq(agentSignals.tool, input.tool),
        eq(agentSignals.sessionId, input.sessionId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    // A resumed session reports again: newer numbers, and its day is not digested yet.
    await scope.handle.db
      .update(agentSignals)
      .set({ ...row, digestedAt: null })
      .where(eq(agentSignals.id, existing[0].id));
    if (existing[0].day !== day) await recountDay(scope, existing[0].day);
  } else {
    await scope.handle.db.insert(agentSignals).values({
      id: newId(),
      userId: scope.userId,
      sessionId: input.sessionId,
      tool: input.tool,
      ...row,
      createdAt: new Date(),
    });
  }
  await recountDay(scope, day);
  return day;
}

/** Recomputes one day's totals from its signals. A day with no signals left keeps its row. */
export async function recountDay(scope: Scope, day: string): Promise<void> {
  const { agentSignals, agentDays } = scope.handle.schema;
  const signals = await scope.handle.db
    .select()
    .from(agentSignals)
    .where(and(eq(agentSignals.userId, scope.userId), eq(agentSignals.day, day)));
  if (signals.length === 0) return;

  const tools: Record<string, { sessions: number; tokens: number }> = {};
  let agentMs = 0;
  let input = 0;
  let output = 0;
  let cache = 0;
  let details: AgentSessionDetails = {};
  for (const s of signals) {
    const { title: _title, endReason: _reason, ...countable } = s.details ?? {};
    details = addDetails(details, countable);
    // A session left open overnight is not a night of work: when the hook measured busy
    // time (gaps over five minutes left out), that is the session's time.
    const openMs = Math.max(0, s.endedAt.getTime() - s.startedAt.getTime());
    const busy = s.details?.busyMinutes;
    agentMs += busy !== undefined ? Math.min(openMs, busy * 60_000) : openMs;
    input += s.inputTokens;
    output += s.outputTokens;
    cache += s.cacheTokens;
    const tool = (tools[s.tool] ??= { sessions: 0, tokens: 0 });
    tool.sessions += 1;
    tool.tokens += s.inputTokens + s.outputTokens + s.cacheTokens;
  }
  const totals = {
    sessions: signals.length,
    // Parallel sessions count once (the union), and never more than the busy time.
    activeMinutes: Math.min(
      unionMinutes(signals.map((s) => ({ start: s.startedAt, end: s.endedAt }))),
      Math.round(agentMs / 60_000),
    ),
    agentMinutes: Math.round(agentMs / 60_000),
    inputTokens: input,
    outputTokens: output,
    cacheTokens: cache,
    tools,
    details,
    updatedAt: new Date(),
  };
  await scope.handle.db
    .insert(agentDays)
    .values({ userId: scope.userId, day, ...totals })
    .onConflictDoUpdate({ target: [agentDays.userId, agentDays.day], set: totals });
}

export interface AgentDay {
  day: string;
  sessions: number;
  activeMinutes: number;
  agentMinutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  tools: Record<string, { sessions: number; tokens: number }>;
  details: AgentSessionDetails;
}

/** Daily totals from [from] (YYYY-MM-DD) on, oldest first. */
export async function listAgentDays(scope: Scope, from: string): Promise<AgentDay[]> {
  const { agentDays } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(agentDays)
    .where(and(eq(agentDays.userId, scope.userId), gte(agentDays.day, from)))
    .orderBy(asc(agentDays.day));
  return rows.map((row) => ({
    day: row.day,
    sessions: row.sessions,
    activeMinutes: row.activeMinutes,
    agentMinutes: row.agentMinutes,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheTokens: row.cacheTokens,
    tools: row.tools ?? {},
    details: row.details ?? {},
  }));
}

export interface SignalForDigest {
  tool: string;
  repo: string | null;
  branch: string | null;
  minutes: number;
  filesChanged: number;
  commits: string[];
  /** Only when the person opted in to sending session titles. */
  title?: string;
  linesAdded?: number;
  linesRemoved?: number;
  languages?: Record<string, number>;
}

export async function signalsForDay(scope: Scope, day: string): Promise<SignalForDigest[]> {
  const { agentSignals } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(agentSignals)
    .where(and(eq(agentSignals.userId, scope.userId), eq(agentSignals.day, day)))
    .orderBy(asc(agentSignals.startedAt));
  return rows.map((row) => ({
    tool: row.tool,
    repo: row.repo,
    branch: row.branch,
    minutes: Math.round(Math.max(0, row.endedAt.getTime() - row.startedAt.getTime()) / 60_000),
    filesChanged: row.filesChanged,
    commits: row.commits ?? [],
    ...(row.details?.title ? { title: row.details.title } : {}),
    ...(row.details?.linesAdded !== undefined ? { linesAdded: row.details.linesAdded } : {}),
    ...(row.details?.linesRemoved !== undefined ? { linesRemoved: row.details.linesRemoved } : {}),
    ...(row.details?.languages ? { languages: row.details.languages } : {}),
  }));
}

export async function markDayDigested(scope: Scope, day: string, now = new Date()) {
  const { agentSignals } = scope.handle.schema;
  await scope.handle.db
    .update(agentSignals)
    .set({ digestedAt: now })
    .where(and(eq(agentSignals.userId, scope.userId), eq(agentSignals.day, day)));
}

/**
 * Every (user, day) with signals not yet digested, for days that are over in the user's
 * timezone. The worker queues a digest for each.
 */
export async function undigestedDays(
  handle: DbHandle,
  now = new Date(),
): Promise<{ userId: string; day: string }[]> {
  const { agentSignals } = handle.schema;
  const rows = await handle.db
    .selectDistinct({ userId: agentSignals.userId, day: agentSignals.day })
    .from(agentSignals)
    .where(isNull(agentSignals.digestedAt));
  const out: { userId: string; day: string }[] = [];
  const today = new Map<string, string>();
  for (const row of rows) {
    if (!today.has(row.userId)) today.set(row.userId, await todayFor(handle, row.userId, now));
    if (row.day < today.get(row.userId)!) out.push(row);
  }
  return out;
}

/** Deletes signals whose day was digested more than a week ago. Returns how many. */
export async function purgeOldSignals(handle: DbHandle, now = new Date()): Promise<number> {
  const { agentSignals } = handle.schema;
  const cutoff = new Date(now.getTime() - SIGNAL_RETENTION_MS);
  const old = await handle.db
    .select({ id: agentSignals.id })
    .from(agentSignals)
    .where(lt(agentSignals.digestedAt, cutoff));
  if (old.length === 0) return 0;
  await handle.db.delete(agentSignals).where(
    inArray(
      agentSignals.id,
      old.map((row) => row.id),
    ),
  );
  return old.length;
}

// ---------------------------------------------------------------- highlights

export interface Highlight {
  id: string;
  day: string;
  text: string;
  kind: HighlightKind;
  status: HighlightStatus;
  repo: string | null;
  /** Kept, but not shown on the public page. */
  hiddenFromPage: boolean;
}

function toHighlight(row: {
  id: string;
  day: string;
  text: string;
  kind: string;
  status: string;
  repo: string | null;
  hiddenFromPage?: boolean | null;
}): Highlight {
  return {
    id: row.id,
    day: row.day,
    text: row.text,
    kind: (HIGHLIGHT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as HighlightKind)
      : "progress",
    status: (HIGHLIGHT_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as HighlightStatus)
      : "draft",
    repo: row.repo,
    hiddenFromPage: Boolean(row.hiddenFromPage),
  };
}

/** A line the person asked for. Skips the digest's filter and starts as kept. */
export async function pinHighlight(
  scope: Scope,
  input: { text: string; repo?: string | null; now?: Date },
): Promise<Highlight> {
  const { agentHighlights } = scope.handle.schema;
  const now = input.now ?? new Date();
  const row = {
    id: newId(),
    userId: scope.userId,
    day: await todayFor(scope.handle, scope.userId, now),
    text: hideSecrets(input.text).replace(/\s+/g, " ").trim().slice(0, 280),
    kind: "pinned",
    status: "kept",
    repo: input.repo ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await scope.handle.db.insert(agentHighlights).values(row);
  return toHighlight(row);
}

/** Highlights from [from] on, newest day first; dropped ones only when asked for. */
export async function listHighlights(
  scope: Scope,
  options: { from: string; to?: string; includeDropped?: boolean },
): Promise<Highlight[]> {
  const { agentHighlights } = scope.handle.schema;
  const conditions = [
    eq(agentHighlights.userId, scope.userId),
    gte(agentHighlights.day, options.from),
  ];
  if (options.to) conditions.push(lte(agentHighlights.day, options.to));
  if (!options.includeDropped) {
    conditions.push(sql`${agentHighlights.status} <> 'dropped'`);
  }
  const rows = await scope.handle.db
    .select()
    .from(agentHighlights)
    .where(and(...conditions))
    .orderBy(desc(agentHighlights.day), asc(agentHighlights.createdAt));
  return rows.map(toHighlight);
}

export async function updateHighlight(
  scope: Scope,
  id: string,
  patch: { text?: string; status?: HighlightStatus; hiddenFromPage?: boolean },
): Promise<Highlight | null> {
  const { agentHighlights } = scope.handle.schema;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.text !== undefined) set.text = hideSecrets(patch.text).trim().slice(0, 280);
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.hiddenFromPage !== undefined) set.hiddenFromPage = patch.hiddenFromPage;
  await scope.handle.db
    .update(agentHighlights)
    .set(set)
    .where(and(eq(agentHighlights.userId, scope.userId), eq(agentHighlights.id, id)));
  const rows = await scope.handle.db
    .select()
    .from(agentHighlights)
    .where(and(eq(agentHighlights.userId, scope.userId), eq(agentHighlights.id, id)))
    .limit(1);
  return rows[0] ? toHighlight(rows[0]) : null;
}

/**
 * Replaces a day's drafts with a new set. Kept, dropped and pinned lines stay, so a
 * second digest of the same day never undoes what the person already decided.
 */
export async function replaceDrafts(
  scope: Scope,
  day: string,
  drafts: readonly { text: string; kind: Exclude<HighlightKind, "pinned">; repo: string | null }[],
): Promise<void> {
  const { agentHighlights } = scope.handle.schema;
  const now = new Date();
  await scope.handle.db
    .delete(agentHighlights)
    .where(
      and(
        eq(agentHighlights.userId, scope.userId),
        eq(agentHighlights.day, day),
        eq(agentHighlights.status, "draft"),
      ),
    );
  if (drafts.length === 0) return;
  await scope.handle.db.insert(agentHighlights).values(
    drafts.map((draft) => ({
      id: newId(),
      userId: scope.userId,
      day,
      text: hideSecrets(draft.text).trim().slice(0, 280),
      kind: draft.kind,
      status: "draft",
      repo: draft.repo,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/** Days with at least one kept or pinned line: "days building" (PRD 29.3). */
export async function keptDays(scope: Scope, from: string): Promise<string[]> {
  const { agentHighlights } = scope.handle.schema;
  const rows = await scope.handle.db
    .selectDistinct({ day: agentHighlights.day })
    .from(agentHighlights)
    .where(
      and(
        eq(agentHighlights.userId, scope.userId),
        gte(agentHighlights.day, from),
        // Drafted lines go on the page by themselves; only ones removed stay off.
        ne(agentHighlights.status, "dropped"),
      ),
    )
    .orderBy(asc(agentHighlights.day));
  return rows.map((row) => row.day);
}
