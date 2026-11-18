// SPDX-License-Identifier: AGPL-3.0-only
// What a public page shows of work done with coding agents (PRD 29.3).
//
// The owner picks one of three: off, numbers, or numbers and kept highlights. Off means
// nothing at all: no section, no hint that it exists, and agent days do not count in the
// streak or the activity grid, so a coding-only day cannot show up as an unexplained gap
// or bump. Everything here is built from what the chosen setting allows, and nothing
// else, so a visitor's numbers always match what they can see.

import { and, asc, desc, eq, gte, lte, ne } from "drizzle-orm";
import type { Scope } from "./context";

export const BUILDING_VISIBILITIES = ["off", "numbers", "highlights"] as const;
export type BuildingVisibility = (typeof BUILDING_VISIBILITIES)[number];

export function asBuildingVisibility(value: string | null | undefined): BuildingVisibility {
  return (BUILDING_VISIBILITIES as readonly string[]).includes(value ?? "")
    ? (value as BuildingVisibility)
    : "off";
}

const DAY_MS = 86_400_000;

/**
 * How much a day of building adds to the one activity grid, on the same scale as reads
 * and reviews: an hour or less is like one, a long day like a busy day of reading.
 */
export function buildWeight(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 60) return 1;
  if (minutes < 180) return 2;
  return 4;
}

export interface PublicBuilding {
  /** Days with at least one agent session. */
  daysBuilding: number;
  sessions: number;
  /** Active time: parallel sessions count once. */
  activeMinutes: number;
  linesAdded: number;
  linesRemoved: number;
  /** File extensions, most used first. */
  languages: string[];
  /** The last 30 days. */
  recent: { minutes: number; days: number };
  /** Share of tokens per model. Null unless the owner turned models on. */
  models: { name: string; share: number }[] | null;
  /** Total tokens. Null unless the owner turned models on. */
  tokens: number | null;
}

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The building section for a page, or null when it is off. Also returns the days it
 * covers, so the streak and grid can count them only when they are visible.
 */
export async function loadPublicBuilding(
  scope: Scope,
  options: { visibility: BuildingVisibility; showModels: boolean; now?: Date },
): Promise<{ building: PublicBuilding; days: Map<string, number> } | null> {
  if (options.visibility === "off") return null;
  const now = options.now ?? new Date();
  const { agentDays } = scope.handle.schema;

  const rows = await scope.handle.db
    .select()
    .from(agentDays)
    .where(eq(agentDays.userId, scope.userId));
  const active = rows.filter((row) => row.sessions > 0);

  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const monthAgo = dayKey(new Date(today - 29 * DAY_MS));
  const languages = new Map<string, number>();
  const models = new Map<string, number>();
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const row of active) {
    const details = row.details ?? {};
    linesAdded += details.linesAdded ?? 0;
    linesRemoved += details.linesRemoved ?? 0;
    for (const [ext, files] of Object.entries(details.languages ?? {})) {
      languages.set(ext, (languages.get(ext) ?? 0) + files);
    }
    for (const [name, usage] of Object.entries(details.models ?? {})) {
      models.set(name, (models.get(name) ?? 0) + usage.input + usage.output + usage.cache);
    }
  }
  const tokens = active.reduce(
    (sum, row) => sum + row.inputTokens + row.outputTokens + row.cacheTokens,
    0,
  );
  const modelTotal = [...models.values()].reduce((sum, n) => sum + n, 0);

  const recentRows = active.filter((row) => row.day >= monthAgo);
  return {
    days: new Map(active.map((row) => [row.day, buildWeight(row.activeMinutes)])),
    building: {
      daysBuilding: active.length,
      sessions: active.reduce((sum, row) => sum + row.sessions, 0),
      activeMinutes: active.reduce((sum, row) => sum + row.activeMinutes, 0),
      linesAdded,
      linesRemoved,
      languages: [...languages]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([ext]) => ext),
      recent: {
        minutes: recentRows.reduce((sum, row) => sum + row.activeMinutes, 0),
        days: recentRows.length,
      },
      models: options.showModels
        ? [...models]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([name, n]) => ({
              name,
              share: modelTotal === 0 ? 0 : Math.round((n / modelTotal) * 100),
            }))
        : null,
      tokens: options.showModels ? tokens : null,
    },
  };
}

/** A day's work with agents, as a standup: what got done, what is going, what was learned. */
export interface PublicBuilt {
  done: string[];
  progress: string[];
  learned: string[];
}

/**
 * Kept lines not hidden from the page, for days from [from] to [to] (YYYY-MM-DD), by
 * day. Only call this when the owner chose to show highlights.
 */
export async function loadPublicBuilt(
  scope: Scope,
  range: { from: string; to: string },
): Promise<Map<string, PublicBuilt>> {
  const { agentHighlights } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(agentHighlights)
    .where(
      and(
        eq(agentHighlights.userId, scope.userId),
        // Drafted lines go on the page by themselves; only ones removed stay off.
        ne(agentHighlights.status, "dropped"),
        eq(agentHighlights.hiddenFromPage, false),
        gte(agentHighlights.day, range.from),
        lte(agentHighlights.day, range.to),
      ),
    )
    .orderBy(desc(agentHighlights.day), asc(agentHighlights.createdAt));
  const days = new Map<string, PublicBuilt>();
  for (const row of rows) {
    const day = days.get(row.day) ?? { done: [], progress: [], learned: [] };
    if (row.kind === "progress") day.progress.push(row.text);
    else if (row.kind === "learned") day.learned.push(row.text);
    else day.done.push(row.text);
    days.set(row.day, day);
  }
  return days;
}
