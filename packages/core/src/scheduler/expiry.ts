// SPDX-License-Identifier: AGPL-3.0-only
// Link expiry (PRD 9.4). This is what stops the pile growing forever.
//
// The shape of the rule matters more than the numbers. A link heads for the exit when
// the user has told us, through their behaviour, that they are not going to read it:
// snoozed too many times, ignored in too many sessions, or sat unread for too long. It
// then gets exactly one more showing, labeled "Last chance", before it expires. Nothing
// is deleted: expired links stay searchable and restorable.
//
// All thresholds are settings and the whole thing can be turned off.

import type { LinkStatus } from "../db/types";

export interface ExpirySettings {
  expiryEnabled: boolean;
  expiryMaxSnoozes: number;
  expiryMaxIgnored: number;
  expiryUnreadDays: number;
}

export const DEFAULT_EXPIRY: ExpirySettings = {
  expiryEnabled: true,
  expiryMaxSnoozes: 5,
  expiryMaxIgnored: 3,
  expiryUnreadDays: 180,
};

export interface ExpiryCandidate {
  linkId: string;
  status: LinkStatus;
  snoozeCount: number;
  ignoredCount: number;
  rescued: boolean;
  savedAt: Date;
  /** Imports start their clock here, so an old backlog is not wiped on day one. */
  importedAt: Date | null;
  /** A link must have been seen at least once before the age rule can apply. */
  everShown: boolean;
}

export type ExpiryReason = "snoozed_too_often" | "ignored_too_often" | "unread_too_long";

export type ExpiryDecision =
  | { action: "none" }
  | { action: "mark_expiring"; reason: ExpiryReason }
  /** A rescued link that trips a rule again skips the last chance and expires. */
  | { action: "expire"; reason: ExpiryReason };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The date the age clock starts from. */
export function expiryClockStart(candidate: Pick<ExpiryCandidate, "savedAt" | "importedAt">): Date {
  return candidate.importedAt ?? candidate.savedAt;
}

export function unreadDays(
  candidate: Pick<ExpiryCandidate, "savedAt" | "importedAt">,
  now: Date,
): number {
  return Math.floor((now.getTime() - expiryClockStart(candidate).getTime()) / DAY_MS);
}

function triggeredReason(
  candidate: ExpiryCandidate,
  settings: ExpirySettings,
  now: Date,
): ExpiryReason | null {
  if (candidate.snoozeCount >= settings.expiryMaxSnoozes) return "snoozed_too_often";
  if (candidate.ignoredCount >= settings.expiryMaxIgnored) return "ignored_too_often";
  if (candidate.everShown && unreadDays(candidate, now) > settings.expiryUnreadDays) {
    return "unread_too_long";
  }
  return null;
}

/** Rule 1 and rule 2 of PRD 9.4. Pure, so it is cheap to test every branch. */
export function decideExpiry(input: {
  candidate: ExpiryCandidate;
  settings: ExpirySettings;
  now: Date;
}): ExpiryDecision {
  const { candidate, settings, now } = input;
  if (!settings.expiryEnabled) return { action: "none" };
  if (candidate.status !== "unread" && candidate.status !== "snoozed") return { action: "none" };

  const reason = triggeredReason(candidate, settings, now);
  if (!reason) return { action: "none" };

  return candidate.rescued ? { action: "expire", reason } : { action: "mark_expiring", reason };
}

/** What an `expiring` link reports as its life left: nearly gone, but not yet gone. */
export const LAST_CHANCE_LIFE_LEFT = 0.05;

/** One rule's remaining share: 1 when nothing has counted against it, 0 when it trips. */
function share(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return 1 - used / limit;
}

/**
 * How much of its life a link has left before the rules above send it to "Last chance",
 * from 1 (fresh) to 0 (gone). Clients draw it; nothing decides on it. It is the smallest
 * of the three rules' remaining shares, because whichever rule is closest is the one
 * that will fire.
 *
 * null means the link does not expire at all: expiry is off, or it is read or dropped.
 */
export function lifeLeft(input: {
  candidate: Pick<
    ExpiryCandidate,
    "status" | "snoozeCount" | "ignoredCount" | "savedAt" | "importedAt"
  >;
  settings: ExpirySettings;
  now: Date;
}): number | null {
  const { candidate, settings, now } = input;
  if (!settings.expiryEnabled) return null;

  switch (candidate.status) {
    case "read":
    case "dropped":
      return null;
    case "expired":
      return 0;
    case "expiring":
      return LAST_CHANCE_LIFE_LEFT;
    case "unread":
    case "snoozed":
      break;
  }

  // The age share counts down from the save (or import) even before the link has been
  // shown. decideExpiry waits for everShown before the age rule can fire, but this is a
  // countdown for display, not a decision, so an unseen link still shows its clock.
  const remaining = Math.min(
    share(candidate.snoozeCount, settings.expiryMaxSnoozes),
    share(candidate.ignoredCount, settings.expiryMaxIgnored),
    share(unreadDays(candidate, now), settings.expiryUnreadDays),
  );
  return Math.min(1, Math.max(0, remaining));
}

/**
 * What happens when a link that is already `expiring` gets shown one last time.
 * Read rescues it outright. A snooze buys one more life and sets rescued, which is what
 * makes the next trip to the exit final. Drop or silence ends it.
 */
export type LastChanceOutcome = "read" | "snoozed" | "dropped" | "ignored";

export interface LastChanceResult {
  status: LinkStatus;
  snoozeCount: number;
  rescued: boolean;
}

export function resolveLastChance(input: {
  candidate: ExpiryCandidate;
  outcome: LastChanceOutcome;
}): LastChanceResult {
  const { candidate, outcome } = input;
  switch (outcome) {
    case "read":
      return { status: "read", snoozeCount: candidate.snoozeCount, rescued: candidate.rescued };
    case "snoozed":
      return { status: "snoozed", snoozeCount: 0, rescued: true };
    case "dropped":
      return { status: "dropped", snoozeCount: candidate.snoozeCount, rescued: candidate.rescued };
    case "ignored":
      return { status: "expired", snoozeCount: candidate.snoozeCount, rescued: candidate.rescued };
  }
}

export function explainExpiryReason(reason: ExpiryReason): string {
  switch (reason) {
    case "snoozed_too_often":
      return "You have put this off a few times.";
    case "ignored_too_often":
      return "This has come up a few times without an answer.";
    case "unread_too_long":
      return "This has been sitting unread for a long time.";
  }
}
