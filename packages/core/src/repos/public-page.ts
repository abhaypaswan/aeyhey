// SPDX-License-Identifier: AGPL-3.0-only
// The "What I learned" public page (PRD 28).
//
// A user can turn on a page that lists links they read, each with a takeaway they wrote or
// confirmed. Two rules shape everything in this file:
//
//   1. Nothing is public by accident. The page is off until the user turns it on, and a
//      link shows only after the user shares it with a takeaway they saw (FR-PUB-1 to 3).
//   2. A public read never returns more than the page shows. publicPageByHandle builds its
//      own narrow shape, so a new column on links cannot leak onto the page by itself.

import { and, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import type { PublicExperience, PublicLink, PublicProject } from "../db/types";
import { loadPublicStats, type PublicStats } from "./public-stats";
import {
  asBuildingVisibility,
  loadPublicBuilding,
  loadPublicBuilt,
  type BuildingVisibility,
  type PublicBuilding,
  type PublicBuilt,
} from "./public-building";
import { localDay } from "./agent";
import { avatarVersion } from "./profile";
import { clampLimit, decodeCursor, encodeCursor, scopeFor, type Page, type Scope } from "./context";

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
export const TAKEAWAY_MAX = 500;
export const TITLE_MAX = 80;
export const BIO_MAX = 160;
export const PUBLIC_PAGE_SIZE = 20;

/**
 * Names a page cannot take. Some would collide with hosted subdomains (app.aeyhey.com),
 * some would let a page pass for an official one. Kept in one list so the web, the API
 * and the hosted subdomain router all agree (FR-PUB-7).
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "aeyhey",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "cdn",
  "connect",
  "dashboard",
  "dev",
  "docs",
  "help",
  "home",
  "login",
  "logout",
  "mail",
  "me",
  "new",
  "official",
  "pages",
  "pricing",
  "privacy",
  "root",
  "security",
  "settings",
  "signin",
  "signup",
  "staging",
  "static",
  "status",
  "support",
  "system",
  "team",
  "terms",
  "test",
  "u",
  "www",
]);

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Why a handle is not usable, written for the person typing it. Null when it is fine. */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
    return `Use ${HANDLE_MIN} to ${HANDLE_MAX} characters.`;
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return "Use lowercase letters, numbers and hyphens, starting and ending with a letter or number.";
  }
  if (handle.includes("--")) return "Use one hyphen at a time.";
  if (RESERVED_HANDLES.has(handle)) return "That name is reserved. Try another.";
  return null;
}

/** Lowercases and trims what someone typed, and drops a leading @ they may have added. */
export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export class HandleTakenError extends Error {
  override readonly name = "handle_taken";
  readonly status = 409;
  constructor() {
    super("Someone already has that name. Try another.");
  }
}

export class InvalidHandleError extends Error {
  override readonly name = "invalid_handle";
  readonly status = 400;
}

export interface PublicProfile {
  handle: string;
  title: string | null;
  bio: string | null;
  enabled: boolean;
  indexable: boolean;
  showFooter: boolean;
  showStats: boolean;
  /** off, numbers, or numbers and kept highlights (PRD 29.3). */
  buildingVisibility: BuildingVisibility;
  showAgentModels: boolean;
  headline: string | null;
  location: string | null;
  links: PublicLink[];
  skills: string[];
  interests: string[];
  experience: PublicExperience[];
  projects: PublicProject[];
  createdAt: Date;
  updatedAt: Date;
}

export async function findPublicProfile(scope: Scope): Promise<PublicProfile | null> {
  const { publicProfiles } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(publicProfiles)
    .where(eq(publicProfiles.userId, scope.userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    handle: row.handle,
    title: row.title,
    bio: row.bio,
    enabled: row.enabled,
    indexable: row.indexable,
    showFooter: row.showFooter,
    showStats: row.showStats,
    buildingVisibility: asBuildingVisibility(row.buildingVisibility),
    showAgentModels: row.showAgentModels,
    headline: row.headline,
    location: row.location,
    links: row.links ?? [],
    skills: row.skills ?? [],
    interests: row.interests ?? [],
    experience: row.experience ?? [],
    projects: row.projects ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** How long an old handle keeps redirecting, and stays held for its owner (FR-PUB-7). */
export const OLD_HANDLE_DAYS = 30;

function oldHandleCutoff(now = new Date()): Date {
  return new Date(now.getTime() - OLD_HANDLE_DAYS * 86_400_000);
}

/**
 * True when nobody else on this instance holds the handle, either now or as a handle they
 * changed away from in the last 30 days (that one still redirects to their page).
 */
export async function handleAvailable(scope: Scope, handle: string): Promise<boolean> {
  const { publicProfiles } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ userId: publicProfiles.userId })
    .from(publicProfiles)
    .where(
      or(
        eq(publicProfiles.handle, handle),
        and(
          eq(publicProfiles.previousHandle, handle),
          gt(publicProfiles.handleChangedAt, oldHandleCutoff()),
        ),
      ),
    );
  return rows.every((row) => row.userId === scope.userId);
}

export interface PublicProfilePatch {
  handle?: string;
  title?: string | null;
  bio?: string | null;
  enabled?: boolean;
  indexable?: boolean;
  showFooter?: boolean;
  showStats?: boolean;
  buildingVisibility?: BuildingVisibility;
  showAgentModels?: boolean;
  headline?: string | null;
  location?: string | null;
  links?: PublicLink[];
  skills?: string[];
  interests?: string[];
  experience?: PublicExperience[];
  projects?: PublicProject[];
}

/**
 * Creates the profile on first save, updates it after. The first save needs a handle,
 * because the handle is the page's address.
 */
export async function savePublicProfile(
  scope: Scope,
  patch: PublicProfilePatch,
): Promise<PublicProfile> {
  const { publicProfiles } = scope.handle.schema;
  const existing = await findPublicProfile(scope);

  let handle = existing?.handle;
  if (patch.handle !== undefined) {
    const next = normalizeHandle(patch.handle);
    const problem = handleProblem(next);
    if (problem) throw new InvalidHandleError(problem);
    if (next !== existing?.handle && !(await handleAvailable(scope, next))) {
      throw new HandleTakenError();
    }
    handle = next;
  }
  if (!handle) throw new InvalidHandleError("Pick a name for your page first.");

  const clean = (value: string | null | undefined) =>
    value === undefined ? undefined : value === null ? null : value.trim() || null;

  const now = new Date();
  const renamed = existing !== null && handle !== existing.handle;
  const fields = {
    handle,
    // The old address keeps working for 30 days, and nobody else can take it meanwhile.
    ...(renamed ? { previousHandle: existing.handle, handleChangedAt: now } : {}),
    ...(patch.title !== undefined ? { title: clean(patch.title) ?? null } : {}),
    ...(patch.bio !== undefined ? { bio: clean(patch.bio) ?? null } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.indexable !== undefined ? { indexable: patch.indexable } : {}),
    ...(patch.showFooter !== undefined ? { showFooter: patch.showFooter } : {}),
    ...(patch.showStats !== undefined ? { showStats: patch.showStats } : {}),
    ...(patch.buildingVisibility !== undefined
      ? { buildingVisibility: patch.buildingVisibility }
      : {}),
    ...(patch.showAgentModels !== undefined ? { showAgentModels: patch.showAgentModels } : {}),
    ...(patch.headline !== undefined ? { headline: clean(patch.headline) ?? null } : {}),
    ...(patch.location !== undefined ? { location: clean(patch.location) ?? null } : {}),
    ...(patch.links !== undefined ? { links: patch.links } : {}),
    ...(patch.skills !== undefined ? { skills: tidyList(patch.skills) } : {}),
    ...(patch.interests !== undefined ? { interests: tidyList(patch.interests) } : {}),
    ...(patch.experience !== undefined ? { experience: patch.experience } : {}),
    ...(patch.projects !== undefined ? { projects: patch.projects } : {}),
    updatedAt: now,
  };

  try {
    if (existing) {
      await scope.handle.db
        .update(publicProfiles)
        .set(fields)
        .where(eq(publicProfiles.userId, scope.userId));
    } else {
      await scope.handle.db
        .insert(publicProfiles)
        .values({ userId: scope.userId, createdAt: now, ...fields });
    }
  } catch (error) {
    // Two people racing for one handle: the unique index decides, and the loser hears
    // the same thing they would have heard a second later.
    if (/unique|duplicate/i.test((error as Error).message)) throw new HandleTakenError();
    throw error;
  }

  return (await findPublicProfile(scope))!;
}

// ---------------------------------------------------------------- shared links

export interface SharedLink {
  id: string;
  url: string;
  title: string | null;
  siteName: string | null;
  takeaway: string;
  readAt: Date | null;
  sharedAt: Date;
}

export class NotReadYetError extends Error {
  override readonly name = "not_read";
  readonly status = 409;
  constructor() {
    super("Mark this link as read before you put it on your page.");
  }
}

/** Puts a read link on the page, or changes its takeaway if it is there already. */
export async function shareLink(
  scope: Scope,
  linkId: string,
  takeaway: string,
): Promise<{ sharedAt: Date } | null> {
  const { links } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ status: links.status, sharedAt: links.sharedAt })
    .from(links)
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.status !== "read") throw new NotReadYetError();

  // Editing the takeaway keeps the original date, so an edit does not jump the list.
  const sharedAt = row.sharedAt ?? new Date();
  await scope.handle.db
    .update(links)
    .set({ sharedAt, publicTakeaway: takeaway.trim(), updatedAt: new Date() })
    .where(and(eq(links.userId, scope.userId), eq(links.id, linkId)));
  return { sharedAt };
}

/** Takes a link off the page. The takeaway is cleared too: unshared means gone. */
export async function unshareLink(scope: Scope, linkId: string): Promise<boolean> {
  const { links } = scope.handle.schema;
  const where = and(eq(links.userId, scope.userId), eq(links.id, linkId));
  const rows = await scope.handle.db.select({ id: links.id }).from(links).where(where).limit(1);
  if (!rows[0]) return false;
  await scope.handle.db
    .update(links)
    .set({ sharedAt: null, publicTakeaway: null, updatedAt: new Date() })
    .where(where);
  return true;
}

/** Newest first, with cursor pagination like the inbox. */
export async function listSharedLinks(
  scope: Scope,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<Page<SharedLink>> {
  const { links } = scope.handle.schema;
  const limit = clampLimit(options.limit ?? PUBLIC_PAGE_SIZE);
  const after = decodeCursor(options.cursor);

  const conditions = [
    eq(links.userId, scope.userId),
    isNotNull(links.sharedAt),
    isNotNull(links.publicTakeaway),
    // A link moved back to unread or dropped leaves the page, even if the row still has
    // a takeaway from before.
    eq(links.status, "read"),
  ];
  if (after && after.length === 2) {
    const [at, id] = after as [number, string];
    const when = new Date(at);
    conditions.push(or(lt(links.sharedAt, when), and(eq(links.sharedAt, when), lt(links.id, id)))!);
  }

  const rows = await scope.handle.db
    .select({
      id: links.id,
      url: links.url,
      title: links.title,
      siteName: links.siteName,
      takeaway: links.publicTakeaway,
      readAt: links.readAt,
      sharedAt: links.sharedAt,
    })
    .from(links)
    .where(and(...conditions))
    .orderBy(desc(links.sharedAt), desc(links.id))
    .limit(limit + 1);

  const items = rows.slice(0, limit).map((row) => ({
    ...row,
    takeaway: row.takeaway ?? "",
    sharedAt: row.sharedAt!,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor([last.sharedAt.getTime(), last.id]) : null,
  };
}

export async function countSharedLinks(scope: Scope): Promise<number> {
  const { links } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ n: sql<number>`count(*)` })
    .from(links)
    .where(
      and(
        eq(links.userId, scope.userId),
        isNotNull(links.sharedAt),
        isNotNull(links.publicTakeaway),
        eq(links.status, "read"),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------- the public read

/** One day on the page: at most a Learned section and a Built section. */
export interface PublicDay {
  day: string;
  /** Takeaways from what was read that day, with where each came from. */
  learned: {
    text: string;
    title: string | null;
    url: string;
    site: string | null;
    /** The link's id, only in the owner's own view, so a takeaway can be edited. */
    linkId?: string;
  }[];
  /** Null when there is no agent work to show for the day, or the owner hides it. */
  built: PublicBuilt | null;
}

/** Everything a visitor sees, and nothing else. */
export interface PublicPage {
  handle: string;
  /** The person's name, when they have set one. */
  name: string | null;
  /** Their picture, with a version that changes with it, or null with none. */
  avatarUrl: string | null;
  title: string;
  bio: string | null;
  indexable: boolean;
  showFooter: boolean;
  items: {
    url: string;
    title: string | null;
    site: string | null;
    takeaway: string;
    readAt: string | null;
    sharedAt: string;
  }[];
  nextCursor: string | null;
  /**
   * What was learned, day by day, newest first: the day's takeaways from reading and,
   * when the owner chose to show it, a standup of the day's work with agents. A day
   * with only hidden agent work does not appear at all.
   */
  days: PublicDay[];
  /** Fetch older days with this, from GET /u/{handle}/days. Null when there are none. */
  nextDaysCursor: string | null;
  /** Null when the owner turned stats off, and on pages after the first. */
  stats: PublicStats | null;
  /** Work done with coding agents. Null when the owner keeps it private (the default). */
  building: PublicBuilding | null;
  /** The work side, all typed by the owner for this page. Empty until they fill it in. */
  headline: string | null;
  location: string | null;
  links: PublicLink[];
  skills: string[];
  interests: string[];
  experience: PublicExperience[];
  projects: PublicProject[];
}

/**
 * The page for a handle, for anyone. Null when there is no such handle or the page is
 * off, so a visitor cannot tell a disabled page from a missing one.
 *
 * This is the only function here that starts without a Scope: the visitor is not a user.
 * It looks the owner up by handle and then reads through a Scope for that owner, so the
 * per-user rule still holds for the links query.
 */
export async function publicPageByHandle(
  handle: DbHandle,
  rawHandle: string,
  options: {
    cursor?: string | null;
    /** For the owner's own preview: a hidden page still reads, with nothing else widened. */
    includeHidden?: boolean;
  } = {},
): Promise<PublicPage | null> {
  const { publicProfiles, users } = handle.schema;
  const wanted = normalizeHandle(rawHandle);
  if (handleProblem(wanted)) return null;

  const rows = await handle.db
    .select({
      userId: publicProfiles.userId,
      handle: publicProfiles.handle,
      title: publicProfiles.title,
      bio: publicProfiles.bio,
      enabled: publicProfiles.enabled,
      indexable: publicProfiles.indexable,
      showFooter: publicProfiles.showFooter,
      showStats: publicProfiles.showStats,
      buildingVisibility: publicProfiles.buildingVisibility,
      showAgentModels: publicProfiles.showAgentModels,
      headline: publicProfiles.headline,
      location: publicProfiles.location,
      links: publicProfiles.links,
      skills: publicProfiles.skills,
      interests: publicProfiles.interests,
      experience: publicProfiles.experience,
      projects: publicProfiles.projects,
      displayName: users.displayName,
    })
    .from(publicProfiles)
    .leftJoin(users, eq(users.id, publicProfiles.userId))
    .where(eq(publicProfiles.handle, wanted))
    .limit(1);
  const profile = rows[0];
  if (!profile || (!profile.enabled && !options.includeHidden)) return null;

  const ownerScope = scopeFor(handle, profile.userId);
  const page = await listSharedLinks(ownerScope, {
    limit: PUBLIC_PAGE_SIZE,
    cursor: options.cursor ?? null,
  });
  const first = !options.cursor;
  const building = first
    ? await loadPublicBuilding(ownerScope, {
        visibility: asBuildingVisibility(profile.buildingVisibility),
        showModels: profile.showAgentModels,
      })
    : null;
  // Agent days count towards the streak and grid only when they are visible.
  const stats =
    profile.showStats && first
      ? await loadPublicStats(ownerScope, new Date(), building?.days)
      : null;
  const name = profile.displayName && profile.displayName !== "You" ? profile.displayName : null;
  const avatar = await avatarVersion(handle, profile.userId);

  return {
    handle: profile.handle,
    name,
    avatarUrl: avatar === null ? null : `/u/${profile.handle}/avatar?v=${avatar}`,
    title: profile.title ?? `What ${name ?? profile.handle} learned`,
    bio: profile.bio,
    indexable: profile.indexable,
    showFooter: profile.showFooter,
    items: page.items.map((item) => ({
      url: item.url,
      title: item.title,
      site: item.siteName ?? hostOf(item.url),
      takeaway: item.takeaway,
      readAt: item.readAt ? item.readAt.toISOString() : null,
      sharedAt: item.sharedAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
    ...(await (async () => {
      const feed = await loadPublicDays(ownerScope, {
        showBuilt: asBuildingVisibility(profile.buildingVisibility) === "highlights",
      });
      return { days: feed.days, nextDaysCursor: feed.nextCursor };
    })()),
    stats,
    building: building?.building ?? null,
    headline: profile.headline,
    location: profile.location,
    // Stored links were checked on the way in; this keeps a bad one off the page anyway.
    links: (profile.links ?? []).filter((link) => isWebUrl(link.url)),
    skills: profile.skills ?? [],
    interests: profile.interests ?? [],
    experience: profile.experience ?? [],
    projects: (profile.projects ?? []).map((project) => ({
      ...project,
      url: project.url && isWebUrl(project.url) ? project.url : null,
    })),
  };
}

/** Only http and https: a javascript: or data: link must never reach a visitor's page. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Trims, drops empties and repeats (ignoring case), keeps the order given. */
function tidyList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export interface ResumeDraft {
  headline: string | null;
  skills: string[];
  experience: PublicExperience[];
  projects: PublicProject[];
}

/**
 * A first draft of the work side from the newest resume the user uploaded, for them to
 * edit before anything is saved. Null when there is no parsed resume. Nothing here is
 * published by itself.
 */
export async function resumeDraft(scope: Scope): Promise<ResumeDraft | null> {
  const { questionSources } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ profile: questionSources.resumeProfile })
    .from(questionSources)
    .where(and(eq(questionSources.userId, scope.userId), isNotNull(questionSources.resumeProfile)))
    .orderBy(desc(questionSources.createdAt))
    .limit(1);
  const profile = rows[0]?.profile;
  if (!profile) return null;

  return {
    headline: profile.headline?.trim() || null,
    skills: tidyList((profile.skills ?? []).map((skill) => skill.name)).slice(0, 20),
    experience: (profile.experiences ?? []).slice(0, 10).map((job) => ({
      role: job.role,
      company: job.company,
      start: job.start ?? null,
      end: job.end ?? null,
      summary: (job.highlights ?? []).slice(0, 2).join(" ").slice(0, 400) || null,
    })),
    projects: (profile.projects ?? []).slice(0, 8).map((project) => ({
      name: project.name,
      description: project.summary?.slice(0, 300) || null,
      url: null,
      tech: (project.tech ?? []).slice(0, 8),
    })),
  };
}

/**
 * The handle a page moved to, when [rawHandle] is one its owner changed away from in the
 * last 30 days. Null otherwise, including when the page is off.
 */
export async function movedHandle(handle: DbHandle, rawHandle: string): Promise<string | null> {
  const { publicProfiles } = handle.schema;
  const wanted = normalizeHandle(rawHandle);
  if (handleProblem(wanted)) return null;
  const rows = await handle.db
    .select({ handle: publicProfiles.handle, enabled: publicProfiles.enabled })
    .from(publicProfiles)
    .where(
      and(
        eq(publicProfiles.previousHandle, wanted),
        gt(publicProfiles.handleChangedAt, oldHandleCutoff()),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row && row.enabled ? row.handle : null;
}

/** Whose page lives at [rawHandle], while it is on. Null for none, or a page turned off. */
export async function findEnabledPageOwner(
  handle: DbHandle,
  rawHandle: string,
): Promise<string | null> {
  const { publicProfiles } = handle.schema;
  const wanted = normalizeHandle(rawHandle);
  if (handleProblem(wanted)) return null;
  const rows = await handle.db
    .select({ userId: publicProfiles.userId, enabled: publicProfiles.enabled })
    .from(publicProfiles)
    .where(eq(publicProfiles.handle, wanted))
    .limit(1);
  const row = rows[0];
  return row && row.enabled ? row.userId : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * What the owner's page shows, for their settings screen: the same stats and building
 * section a visitor gets with the current settings. Stats are computed even when hidden
 * from visitors, so the owner can see what they would be turning on.
 */
export async function ownerPagePreview(
  scope: Scope,
  profile: PublicProfile,
): Promise<{ stats: PublicStats; building: PublicBuilding | null }> {
  const building = await loadPublicBuilding(scope, {
    visibility: profile.buildingVisibility,
    showModels: profile.showAgentModels,
  });
  return {
    stats: await loadPublicStats(scope, new Date(), building?.days),
    building: building?.building ?? null,
  };
}

/** How many days the "What I learned" feed loads at a time. */
export const DAYS_PAGE_SIZE = 7;

export interface PublicDaysPage {
  days: PublicDay[];
  /** Pass back as [before] for the next, older days. Null when there are none. */
  nextCursor: string | null;
}

/**
 * One page of the "What I learned" feed: the newest [limit] days before [before]
 * (YYYY-MM-DD, exclusive), each with its takeaways and, when the owner shows it, the
 * day's Built standup.
 *
 * Finding which days come next reads only dates: the shared takeaways' timestamps (to
 * place each on the owner's local day) and the distinct days that have kept, unhidden
 * highlights. The text is then loaded for the chosen days alone, so a long history is
 * never sent or read in full.
 */
export async function loadPublicDays(
  scope: Scope,
  options: { before?: string | null; limit?: number; showBuilt: boolean; withIds?: boolean },
): Promise<PublicDaysPage> {
  const limit = Math.max(1, Math.min(31, options.limit ?? DAYS_PAGE_SIZE));
  const before =
    options.before && /^\d{4}-\d{2}-\d{2}$/.test(options.before) ? options.before : null;
  const { links, users, agentHighlights } = scope.handle.schema;

  const userRows = await scope.handle.db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, scope.userId))
    .limit(1);
  const timezone = userRows[0]?.timezone ?? "UTC";

  // Dates only, to know which day each shared takeaway falls on.
  const shared = await scope.handle.db
    .select({ id: links.id, readAt: links.readAt, sharedAt: links.sharedAt })
    .from(links)
    .where(
      and(
        eq(links.userId, scope.userId),
        isNotNull(links.sharedAt),
        isNotNull(links.publicTakeaway),
        eq(links.status, "read"),
      ),
    );
  const dayOfLink = new Map<string, string>();
  for (const row of shared) {
    const day = localDay(row.readAt ?? row.sharedAt!, timezone);
    if (!before || day < before) dayOfLink.set(row.id, day);
  }

  let builtDays: string[] = [];
  if (options.showBuilt) {
    const conditions = [
      eq(agentHighlights.userId, scope.userId),
      // Drafted lines go on the page by themselves; only ones removed stay off.
      ne(agentHighlights.status, "dropped"),
      eq(agentHighlights.hiddenFromPage, false),
    ];
    if (before) conditions.push(lt(agentHighlights.day, before));
    const rows = await scope.handle.db
      .selectDistinct({ day: agentHighlights.day })
      .from(agentHighlights)
      .where(and(...conditions))
      .orderBy(desc(agentHighlights.day))
      .limit(limit + 1);
    builtDays = rows.map((row) => row.day);
  }

  const allDays = [...new Set([...dayOfLink.values(), ...builtDays])].sort((a, b) =>
    a < b ? 1 : -1,
  );
  const pageDays = allDays.slice(0, limit);
  if (pageDays.length === 0) return { days: [], nextCursor: null };
  const wanted = new Set(pageDays);

  const days = new Map<string, PublicDay>(
    pageDays.map((day) => [day, { day, learned: [], built: null }]),
  );

  const ids = [...dayOfLink].filter(([, day]) => wanted.has(day)).map(([id]) => id);
  if (ids.length > 0) {
    const rows = await scope.handle.db
      .select({
        id: links.id,
        url: links.url,
        title: links.title,
        siteName: links.siteName,
        takeaway: links.publicTakeaway,
        sharedAt: links.sharedAt,
      })
      .from(links)
      .where(and(eq(links.userId, scope.userId), inArray(links.id, ids)))
      .orderBy(desc(links.sharedAt));
    for (const row of rows) {
      if (!row.takeaway || !isWebUrl(row.url)) continue;
      days.get(dayOfLink.get(row.id)!)!.learned.push({
        text: row.takeaway,
        title: row.title,
        url: row.url,
        site: row.siteName ?? hostOf(row.url),
        ...(options.withIds ? { linkId: row.id } : {}),
      });
    }
  }

  if (options.showBuilt) {
    const built = await loadPublicBuilt(scope, {
      from: pageDays[pageDays.length - 1]!,
      to: pageDays[0]!,
    });
    for (const [day, entry] of built) {
      const target = days.get(day);
      if (target) target.built = entry;
    }
  }

  return {
    days: pageDays.map((day) => days.get(day)!).filter((d) => d.learned.length > 0 || d.built),
    nextCursor: allDays.length > limit ? pageDays[pageDays.length - 1]! : null,
  };
}
