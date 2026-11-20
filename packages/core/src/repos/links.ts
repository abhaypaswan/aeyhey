// SPDX-License-Identifier: AGPL-3.0-only
// Link storage, scoped by user (PRD 8.1, 10, 11).

import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { newId } from "../ids";
import { normalizeUrl } from "../links/normalize";
import { extractUrls } from "../links/extract-urls";
import type { ContentType, ImportSource, LinkStatus } from "../db/types";
import { clampLimit, decodeCursor, encodeCursor, type Page, type Scope } from "./context";
import { tagsForItems } from "./tags";
import { newCard, snapshot } from "../scheduler/scheduler";
import { withTransaction } from "../db/transaction";
import { lifeLeft, type ExpirySettings } from "../scheduler/expiry";
import { loadExpirySettings } from "./settings";

export interface SaveLinksInput {
  /** Raw pasted text. URLs are found, normalized and deduped (PRD 8.1 FR-LINK-1). */
  text: string;
  note?: string | null;
  source?: ImportSource;
  /** Imports keep the original save date so an old backlog stays old. */
  savedAt?: Date;
  importedAt?: Date | null;
}

export interface SaveLinksResult {
  created: { id: string; url: string }[];
  /** URLs the user already had. Shown as "already saved" rather than silently dropped. */
  duplicates: string[];
  /** Things that looked like a URL but were not usable. */
  skipped: string[];
}

/**
 * Saves every new URL found in the text and creates a card for each one, in one
 * transaction. A card per link is what puts it in the scheduler's hands, so the two are
 * never created apart.
 */
export async function saveLinks(scope: Scope, input: SaveLinksInput): Promise<SaveLinksResult> {
  const { links, cards } = scope.handle.schema;
  const found = extractUrls(input.text);

  if (found.urls.length === 0) {
    return { created: [], duplicates: [], skipped: found.skipped };
  }

  const normalizedKeys = found.urls.map((url) => url.normalized);
  const existing = await scope.handle.db
    .select({ urlNormalized: links.urlNormalized })
    .from(links)
    .where(and(eq(links.userId, scope.userId), inArray(links.urlNormalized, normalizedKeys)));

  const already = new Set(existing.map((row) => row.urlNormalized));
  const toCreate = found.urls.filter((url) => !already.has(url.normalized));

  if (toCreate.length === 0) {
    return {
      created: [],
      duplicates: found.urls.filter((u) => already.has(u.normalized)).map((u) => u.url),
      skipped: found.skipped,
    };
  }

  const now = new Date();
  const savedAt = input.savedAt ?? now;
  // A note only makes sense for a single link: attaching one sentence to 45 links would
  // mislead the summarizer about all 45 (PRD 8.1 FR-LINK-2).
  const note = toCreate.length === 1 ? (input.note ?? null) : null;

  const linkRows = toCreate.map((url) => ({
    id: newId(now),
    userId: scope.userId,
    url: url.url,
    urlNormalized: url.normalized,
    userNote: note,
    status: "unread" as LinkStatus,
    importSource: input.source ?? ("paste" as ImportSource),
    savedAt,
    importedAt: input.importedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }));

  const cardRows = linkRows.map((link) => {
    const card = newCard({ id: newId(now), status: "unread", now });
    return {
      id: card.id,
      userId: scope.userId,
      itemType: "link" as const,
      itemId: link.id,
      status: card.status,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      learningSteps: card.learningSteps,
      fsrsState: card.fsrsState,
      lastReview: card.lastReview,
      skipCount: card.skipCount,
      createdAt: now,
      updatedAt: now,
    };
  });

  // The link and its card are created together or not at all: a link with no card
  // would never be scheduled, and a card with no link would break every session.
  await withTransaction(scope.handle, async (tx) => {
    await tx.insert(links).values(linkRows);
    await tx.insert(cards).values(cardRows);
  });

  return {
    created: linkRows.map((row) => ({ id: row.id, url: row.url })),
    duplicates: found.urls.filter((u) => already.has(u.normalized)).map((u) => u.url),
    skipped: found.skipped,
  };
}

export async function findLinkById(scope: Scope, linkId: string) {
  const { links } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(links)
    // The userId predicate is what stops one user reading another's link by guessing an
    // id. It is on every single read in this file for that reason.
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLinkByUrl(scope: Scope, url: string) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;

  const { links } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(links)
    .where(and(eq(links.userId, scope.userId), eq(links.urlNormalized, normalized.normalized)))
    .limit(1);
  return rows[0] ?? null;
}

export interface LinkListFilters {
  status?: LinkStatus | LinkStatus[];
  tag?: string;
  contentType?: string;
  site?: string;
  /** Free text over title, summary, note and extracted text. */
  q?: string;
  sort?: "newest" | "oldest" | "due";
  limit?: number;
  cursor?: string;
}

export interface LinkListItem {
  id: string;
  url: string;
  title: string | null;
  siteName: string | null;
  contentType: ContentType;
  status: LinkStatus;
  summaryLines: [string, string, string] | null;
  whySaved: string | null;
  readMinutes: number | null;
  savedAt: Date;
  aiStatus: string;
  extractStatus: string;
  tags: string[];
  due: Date | null;
  /**
   * How much of its life the link has left before the expiry rules send it to "Last
   * chance", from 1 (fresh) to 0 (expired). null when it does not expire: expiry is off,
   * or the link is read or dropped. See lifeLeft in scheduler/expiry.ts.
   */
  lifeLeft: number | null;
  /**
   * Set while the summary waits because the AI was not allowed to run, such as being out
   * of credits: the reason, in words for the user. null otherwise.
   */
  waitingOnCredits: string | null;
}

/**
 * Why each of these links' summaries is waiting: the reason its blocked summary job
 * gave. Only links still pending can be waiting, so the caller passes just those.
 */
export async function waitingSummaries(
  scope: Scope,
  linkIds: string[],
): Promise<Map<string, string>> {
  const waiting = new Map<string, string>();
  if (linkIds.length === 0) return waiting;
  const { jobs } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ payload: jobs.payload, lastError: jobs.lastError })
    .from(jobs)
    .where(
      and(eq(jobs.userId, scope.userId), eq(jobs.type, "enrich_link"), eq(jobs.status, "blocked")),
    );
  const wanted = new Set(linkIds);
  for (const row of rows) {
    const linkId = (row.payload as Record<string, unknown> | null)?.["linkId"];
    if (typeof linkId === "string" && wanted.has(linkId)) {
      waiting.set(linkId, row.lastError ?? "This summary is waiting for credits.");
    }
  }
  return waiting;
}

/** The link columns lifeLeft reads. */
export interface LifeLeftFields {
  status: LinkStatus;
  snoozeCount: number;
  ignoredCount: number;
  savedAt: Date;
  importedAt: Date | null;
}

/** lifeLeft for one stored link. Load the settings once and pass them to every row. */
export function linkLifeLeft(
  link: LifeLeftFields,
  settings: ExpirySettings,
  now: Date = new Date(),
): number | null {
  return lifeLeft({ candidate: link, settings, now });
}

/** A stored link with its lifeLeft, which is what the API sends for one link. */
export async function findLinkWithLifeLeft(scope: Scope, linkId: string) {
  const link = await findLinkById(scope, linkId);
  if (!link) return null;
  const settings = await loadExpirySettings(scope);
  const waiting =
    link.aiStatus === "pending" ? await waitingSummaries(scope, [link.id]) : new Map();
  return {
    ...link,
    lifeLeft: linkLifeLeft(link, settings),
    waitingOnCredits: waiting.get(link.id) ?? null,
  };
}

export async function listLinks(
  scope: Scope,
  filters: LinkListFilters = {},
): Promise<Page<LinkListItem>> {
  const { links, cards, tags, itemTags } = scope.handle.schema;
  const limit = clampLimit(filters.limit);

  const conditions = [eq(links.userId, scope.userId)];

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(inArray(links.status, statuses));
  }
  if (filters.contentType) conditions.push(eq(links.contentType, filters.contentType as never));
  if (filters.site) conditions.push(eq(links.siteName, filters.site));

  if (filters.q) {
    // LIKE rather than FTS here so one code path covers both dialects. The FTS index is
    // used by src/search for the big queries.
    const needle = `%${filters.q.toLowerCase()}%`;
    conditions.push(
      or(
        sql`lower(${links.title}) like ${needle}`,
        sql`lower(${links.whySaved}) like ${needle}`,
        sql`lower(${links.userNote}) like ${needle}`,
        sql`lower(${links.urlNormalized}) like ${needle}`,
      )!,
    );
  }

  if (filters.tag) {
    // A correlated exists keeps one row per link, which a join would not.
    conditions.push(
      sql`exists (
        select 1 from ${itemTags}
        inner join ${tags} on ${tags.id} = ${itemTags.tagId}
        where ${itemTags.itemType} = 'link'
          and ${itemTags.itemId} = ${links.id}
          and ${tags.userId} = ${scope.userId}
          and ${tags.name} = ${filters.tag}
      )`,
    );
  }

  const cursor = decodeCursor(filters.cursor);
  const sort = filters.sort ?? "newest";

  if (cursor) {
    const [cursorValue, cursorId] = cursor as [number, string];
    const column = sort === "due" ? cards.due : links.savedAt;
    const asDate = new Date(cursorValue);
    // Tie-break on id so a page boundary inside identical timestamps cannot repeat or
    // skip a row.
    conditions.push(
      sort === "oldest"
        ? or(gt(column, asDate), and(eq(column, asDate), gt(links.id, cursorId)))!
        : or(lt(column, asDate), and(eq(column, asDate), lt(links.id, cursorId)))!,
    );
  }

  const orderBy =
    sort === "oldest"
      ? [asc(links.savedAt), asc(links.id)]
      : sort === "due"
        ? [asc(cards.due), asc(links.id)]
        : [desc(links.savedAt), desc(links.id)];

  const rows = await scope.handle.db
    .select({
      id: links.id,
      url: links.url,
      title: links.title,
      siteName: links.siteName,
      contentType: links.contentType,
      status: links.status,
      summaryLines: links.summaryLines,
      whySaved: links.whySaved,
      readMinutes: links.readMinutes,
      savedAt: links.savedAt,
      aiStatus: links.aiStatus,
      extractStatus: links.extractStatus,
      due: cards.due,
      snoozeCount: links.snoozeCount,
      ignoredCount: links.ignoredCount,
      importedAt: links.importedAt,
    })
    .from(links)
    // The card holds the due date, and item_type has to be part of the join condition:
    // link and question ids live in the same column.
    .leftJoin(cards, and(eq(cards.itemId, links.id), eq(cards.itemType, "link")))
    .where(and(...conditions))
    .orderBy(...orderBy)
    // One extra row tells us whether there is a next page without a second count query.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const [tagMap, expirySettings] = await Promise.all([
    tagsForItems(
      scope,
      "link",
      page.map((row) => row.id),
    ),
    loadExpirySettings(scope),
  ]);
  const now = new Date();

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor([(sort === "due" ? last.due : last.savedAt)?.getTime() ?? 0, last.id])
      : null;

  const waiting = await waitingSummaries(
    scope,
    page.filter((row) => row.aiStatus === "pending").map((row) => row.id),
  );

  return {
    // The counters only feed lifeLeft; they stay off the wire so the list shape does not
    // grow by three fields nobody asked for.
    items: page.map(({ snoozeCount, ignoredCount, importedAt, ...row }) => ({
      ...row,
      status: row.status,
      tags: tagMap.get(row.id) ?? [],
      waitingOnCredits: waiting.get(row.id) ?? null,
      lifeLeft: linkLifeLeft(
        { status: row.status, snoozeCount, ignoredCount, savedAt: row.savedAt, importedAt },
        expirySettings,
        now,
      ),
    })),
    nextCursor,
  };
}

export interface UpdateLinkPatch {
  title?: string | null;
  userNote?: string | null;
  status?: LinkStatus;
  readAt?: Date | null;
  snoozeCount?: number;
  ignoredCount?: number;
  rescued?: boolean;
}

export async function updateLink(
  scope: Scope,
  linkId: string,
  patch: UpdateLinkPatch,
): Promise<void> {
  const { links } = scope.handle.schema;
  await scope.handle.db
    .update(links)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)));
}

/** Writes what the extractor found. Called by the extract_link job. */
export async function applyExtraction(
  scope: Scope,
  linkId: string,
  extracted: {
    status: "pending" | "ok" | "partial" | "failed";
    title?: string | null;
    siteName?: string | null;
    author?: string | null;
    publishedAt?: Date | null;
    imageUrl?: string | null;
    contentType: string;
    text?: string | null;
    language?: string | null;
  },
): Promise<void> {
  const { links } = scope.handle.schema;
  await scope.handle.db
    .update(links)
    .set({
      extractStatus: extracted.status,
      title: extracted.title ?? null,
      siteName: extracted.siteName ?? null,
      author: extracted.author ?? null,
      publishedAt: extracted.publishedAt ?? null,
      imageUrl: extracted.imageUrl ?? null,
      contentType: extracted.contentType as never,
      extractedText: extracted.text ?? null,
      language: extracted.language ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)));
}

/**
 * The read or summary job for this link failed for good. Whatever is still pending is
 * marked failed, so the app stops saying it is still reading the link, and the link
 * keeps its title and goes on working like any other.
 */
export async function giveUpOnLink(scope: Scope, linkId: string): Promise<void> {
  const { links } = scope.handle.schema;
  const now = new Date();
  await scope.handle.db
    .update(links)
    .set({ extractStatus: "failed", updatedAt: now })
    .where(
      and(eq(links.userId, scope.userId), eq(links.id, linkId), eq(links.extractStatus, "pending")),
    );
  await scope.handle.db
    .update(links)
    .set({ aiStatus: "failed", updatedAt: now })
    .where(
      and(eq(links.userId, scope.userId), eq(links.id, linkId), eq(links.aiStatus, "pending")),
    );
}

/** Writes what the AI produced. Called by the enrich_link job. */
export async function applyEnrichment(
  scope: Scope,
  linkId: string,
  enriched: {
    aiStatus: "ok" | "failed" | "skipped";
    summaryLines: [string, string, string] | null;
    whySaved: string | null;
    summaryConfidence: "high" | "low" | null;
    contentType: string;
    readMinutes: number | null;
    language: string | null;
  },
): Promise<void> {
  const { links } = scope.handle.schema;
  await scope.handle.db
    .update(links)
    .set({
      aiStatus: enriched.aiStatus,
      summaryLines: enriched.summaryLines,
      whySaved: enriched.whySaved,
      summaryConfidence: enriched.summaryConfidence,
      contentType: enriched.contentType as never,
      readMinutes: enriched.readMinutes,
      language: enriched.language,
      updatedAt: new Date(),
    })
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)));
}

export interface LinkCounts {
  unread: number;
  snoozed: number;
  read: number;
  dropped: number;
  expiring: number;
  expired: number;
}

export async function linkCounts(scope: Scope): Promise<LinkCounts> {
  const { links } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ status: links.status, count: sql<number>`count(*)`.as("count") })
    .from(links)
    .where(eq(links.userId, scope.userId))
    .groupBy(links.status);

  const counts: LinkCounts = {
    unread: 0,
    snoozed: 0,
    read: 0,
    dropped: 0,
    expiring: 0,
    expired: 0,
  };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof LinkCounts] = Number(row.count);
  }
  return counts;
}

/** The snapshot a review log stores, for undo (PRD 9.6). */
export { snapshot as cardSnapshot };
