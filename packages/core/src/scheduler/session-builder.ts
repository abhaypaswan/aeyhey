// SPDX-License-Identifier: AGPL-3.0-only
// Session building (PRD 9.5). A pure function over rows that are already loaded, so
// every rule in the spec has a cheap unit test and no database in sight.
//
// The ordering rules are the opinionated part of Aeyhey:
//   - a session opens with a link when there is one, because tapping "Read now" or
//     "Later" is an easy first decision and gets the user moving
//   - questions are ordered by what the user is most likely to have forgotten
//   - new material is rationed, so one big import does not drown the review queue
//   - no two links in a row while questions remain, so it never feels like a feed

import type { CardStatus, ItemType, MixMode } from "../db/types";
import { retrievability, type SchedulableCard } from "./scheduler";

export interface SessionCandidate extends SchedulableCard {
  itemType: ItemType;
  itemId: string;
  /** Links only. Used for the expiring cap and the "From the archive" slot. */
  savedAt?: Date;
  /** Links only. aiStatus must not be "pending": a card with no summary is not useful. */
  ready?: boolean;
  /** Questions only. Keeps a deck's own order stable for new cards. */
  deckPosition?: number;
  /** True when the user skipped this card in their last session. */
  skippedLastTime?: boolean;
}

export interface SessionSettings {
  cardsPerSession: number;
  mixMode: MixMode;
  mixLinks: number;
  mixQuestions: number;
  maxNewQuestions: number;
  maxNewLinks: number;
  requestRetention: number;
}

export interface BuildSessionInput {
  settings: SessionSettings;
  candidates: SessionCandidate[];
  now: Date;
  /** Cards due at or before this count as eligible. From eligibilityWindow(). */
  eligibleUntil: Date;
}

export interface BuildSessionResult {
  items: SessionCandidate[];
  counts: { links: number; questions: number };
  /** Set when nothing was eligible, so the UI can say the right thing. */
  emptyReason?: "nothing_due" | "nothing_saved";
}

const QUESTION_ACTIVE: CardStatus[] = ["new", "active"];
const LINK_ELIGIBLE: CardStatus[] = ["unread", "snoozed", "expiring"];

function isNew(card: SessionCandidate): boolean {
  return card.fsrsState === 0 || card.status === "new" || card.status === "unread";
}

/** Step 1 and 2: who is even allowed in. */
export function eligibleCandidates(input: BuildSessionInput): {
  questions: SessionCandidate[];
  links: SessionCandidate[];
} {
  const dueBy = input.eligibleUntil.getTime();

  const questions = input.candidates.filter(
    (c) =>
      c.itemType === "question" && QUESTION_ACTIVE.includes(c.status) && c.due.getTime() <= dueBy,
  );

  const links = input.candidates.filter(
    (c) =>
      c.itemType === "link" &&
      LINK_ELIGIBLE.includes(c.status) &&
      c.due.getTime() <= dueBy &&
      c.ready !== false,
  );

  return { questions, links };
}

/** Step 3: how many of each, before either side runs short. */
export function targetCounts(
  settings: SessionSettings,
  available: { questions: number; links: number },
): { links: number; questions: number } {
  const size = Math.max(1, Math.min(30, settings.cardsPerSession));

  if (settings.mixMode === "explicit") {
    const links = Math.min(settings.mixLinks, available.links);
    const questions = Math.min(settings.mixQuestions, available.questions);
    return { links, questions };
  }

  // Auto: a small session gets at most 2 links, a bigger one gets about 40 percent.
  const wantLinks = size <= 5 ? Math.min(2, available.links) : Math.round(size * 0.4);
  let links = Math.min(wantLinks, available.links, size);
  let questions = Math.min(size - links, available.questions);

  // If one side runs short, the other fills the gap rather than shrinking the session.
  if (links + questions < size) {
    const spare = size - links - questions;
    const extraLinks = Math.min(spare, available.links - links);
    links += extraLinks;
    questions += Math.min(size - links - questions, available.questions - questions);
  }

  return { links, questions };
}

/**
 * Step 4: skipped first, then most likely forgotten, then a ration of new cards.
 *
 * There is no retention parameter here on purpose. Retrievability is a function of a
 * card's stability and how long it has been, not of the user's target retention, so
 * their setting cannot change this ordering. It changes the intervals the scheduler
 * picks, which is a different question.
 */
export function orderQuestions(
  candidates: SessionCandidate[],
  now: Date,
  limit: number,
  maxNew: number,
): SessionCandidate[] {
  const skipped = candidates.filter((c) => c.skippedLastTime && !isNew(c));
  const due = candidates.filter((c) => !c.skippedLastTime && !isNew(c));
  const fresh = candidates.filter(isNew);

  const withRetrievability = due
    .map((card) => ({ card, r: retrievability(card, now, false) }))
    .sort((a, b) => a.r - b.r)
    .map((entry) => entry.card);

  const freshOrdered = [...fresh]
    .sort((a, b) => (a.deckPosition ?? 0) - (b.deckPosition ?? 0))
    .slice(0, Math.max(0, maxNew));

  return [...skipped, ...withRetrievability, ...freshOrdered].slice(0, Math.max(0, limit));
}

/**
 * Step 5: at most one expiring link, then snoozed links by oldest due, then a ration of
 * new ones newest first, keeping one slot for the oldest unread link in a session of 5
 * or more. That last slot is the "From the archive" surprise, and it is the whole reason
 * a five year old bookmark ever sees daylight again.
 */
export function orderLinks(
  candidates: SessionCandidate[],
  limit: number,
  maxNew: number,
  sessionSize: number,
): SessionCandidate[] {
  if (limit <= 0) return [];

  const expiring = candidates
    .filter((c) => c.status === "expiring")
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 1);

  const snoozed = candidates
    .filter((c) => c.status === "snoozed")
    .sort((a, b) => a.due.getTime() - b.due.getTime());

  const unread = candidates
    .filter((c) => c.status === "unread")
    .sort((a, b) => (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0));

  const picked: SessionCandidate[] = [...expiring];
  const taken = new Set(picked.map((c) => c.id));

  const wantArchive = sessionSize >= 5 && unread.length > 1;
  const archiveCard = wantArchive
    ? [...unread].sort((a, b) => (a.savedAt?.getTime() ?? 0) - (b.savedAt?.getTime() ?? 0))[0]
    : undefined;

  for (const card of snoozed) {
    if (picked.length >= limit - (archiveCard ? 1 : 0)) break;
    if (taken.has(card.id)) continue;
    picked.push(card);
    taken.add(card.id);
  }

  let newUsed = 0;
  for (const card of unread) {
    if (picked.length >= limit - (archiveCard && !taken.has(archiveCard.id) ? 1 : 0)) break;
    if (taken.has(card.id) || card.id === archiveCard?.id) continue;
    if (newUsed >= maxNew) break;
    picked.push(card);
    taken.add(card.id);
    newUsed += 1;
  }

  if (archiveCard && !taken.has(archiveCard.id) && picked.length < limit) {
    picked.push(archiveCard);
    taken.add(archiveCard.id);
  }

  // Fill any remaining room from whatever is left, so a session is never short on
  // purpose when there is material for it.
  if (picked.length < limit) {
    for (const card of [...snoozed, ...unread]) {
      if (picked.length >= limit) break;
      if (taken.has(card.id)) continue;
      picked.push(card);
      taken.add(card.id);
    }
  }

  return picked.slice(0, limit);
}

/** Step 6: link, question, question, link, and so on. Never two links together. */
export function interleave(
  links: SessionCandidate[],
  questions: SessionCandidate[],
): SessionCandidate[] {
  const out: SessionCandidate[] = [];
  const l = [...links];
  const q = [...questions];

  // Start with a link when there is one: an easy first tap.
  let wantLink = l.length > 0;

  while (l.length > 0 || q.length > 0) {
    if (wantLink && l.length > 0) {
      out.push(l.shift()!);
      wantLink = false;
      continue;
    }
    if (q.length > 0) {
      out.push(q.shift()!);
      // Two questions between links keeps the ratio close to the target without
      // ever putting two links back to back while questions remain.
      if (q.length > 0 && l.length > 0 && out.length % 3 !== 0) {
        out.push(q.shift()!);
      }
      wantLink = l.length > 0;
      continue;
    }
    if (l.length > 0) out.push(l.shift()!);
  }

  return out;
}

export function buildSession(input: BuildSessionInput): BuildSessionResult {
  const { questions: eligibleQuestions, links: eligibleLinks } = eligibleCandidates(input);

  if (eligibleQuestions.length === 0 && eligibleLinks.length === 0) {
    return {
      items: [],
      counts: { links: 0, questions: 0 },
      emptyReason: input.candidates.length === 0 ? "nothing_saved" : "nothing_due",
    };
  }

  const size = Math.max(1, Math.min(30, input.settings.cardsPerSession));
  const counts = targetCounts(input.settings, {
    questions: eligibleQuestions.length,
    links: eligibleLinks.length,
  });

  const links = orderLinks(eligibleLinks, counts.links, input.settings.maxNewLinks, size);
  const questions = orderQuestions(
    eligibleQuestions,
    input.now,
    counts.questions,
    input.settings.maxNewQuestions,
  );

  const items = interleave(links, questions);
  return {
    items,
    counts: { links: links.length, questions: questions.length },
  };
}
