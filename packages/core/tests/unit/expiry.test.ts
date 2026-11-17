// SPDX-License-Identifier: AGPL-3.0-only
// lifeLeft: how close a link is to "Last chance" (PRD 9.4), for clients to draw.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRY,
  LAST_CHANCE_LIFE_LEFT,
  lifeLeft,
  type ExpiryCandidate,
  type ExpirySettings,
} from "../../src/scheduler/expiry";
import type { LinkStatus } from "../../src/db/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-15T12:00:00Z");

const SETTINGS: ExpirySettings = {
  expiryEnabled: true,
  expiryMaxSnoozes: 5,
  expiryMaxIgnored: 3,
  expiryUnreadDays: 180,
};

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function candidate(
  overrides: Partial<Pick<ExpiryCandidate, "snoozeCount" | "ignoredCount" | "importedAt">> & {
    status?: LinkStatus;
    savedDaysAgo?: number;
  } = {},
) {
  return {
    status: overrides.status ?? ("unread" as LinkStatus),
    snoozeCount: overrides.snoozeCount ?? 0,
    ignoredCount: overrides.ignoredCount ?? 0,
    savedAt: daysAgo(overrides.savedDaysAgo ?? 0),
    importedAt: overrides.importedAt ?? null,
  };
}

function life(c: ReturnType<typeof candidate>, settings: ExpirySettings = SETTINGS) {
  return lifeLeft({ candidate: c, settings, now: NOW });
}

describe("lifeLeft", () => {
  it("is full for a link saved just now", () => {
    expect(life(candidate())).toBe(1);
  });

  it("is null for every status when expiry is off", () => {
    const off = { ...SETTINGS, expiryEnabled: false };
    for (const status of ["unread", "snoozed", "expiring", "expired", "read", "dropped"]) {
      expect(life(candidate({ status: status as LinkStatus, snoozeCount: 4 }), off)).toBeNull();
    }
  });

  it("is null for read and dropped links, which do not expire", () => {
    expect(life(candidate({ status: "read", savedDaysAgo: 400 }))).toBeNull();
    expect(life(candidate({ status: "dropped", snoozeCount: 4 }))).toBeNull();
  });

  it("is 0 for an expired link", () => {
    expect(life(candidate({ status: "expired" }))).toBe(0);
  });

  it("is the small fixed value for a link on its last chance", () => {
    expect(life(candidate({ status: "expiring" }))).toBe(LAST_CHANCE_LIFE_LEFT);
    expect(LAST_CHANCE_LIFE_LEFT).toBeGreaterThan(0);
    expect(LAST_CHANCE_LIFE_LEFT).toBeLessThan(0.1);
  });

  it("counts snoozes against the snooze limit", () => {
    expect(life(candidate({ snoozeCount: 2 }))).toBeCloseTo(0.6);
    expect(life(candidate({ status: "snoozed", snoozeCount: 4 }))).toBeCloseTo(0.2);
  });

  it("counts ignored sessions against the ignored limit", () => {
    expect(life(candidate({ ignoredCount: 1 }))).toBeCloseTo(2 / 3);
  });

  it("counts age against the unread days, from the save date", () => {
    expect(life(candidate({ savedDaysAgo: 45 }))).toBeCloseTo(0.75);
  });

  it("starts the age clock at the import date when there is one", () => {
    const c = candidate({ savedDaysAgo: 1000, importedAt: daysAgo(90) });
    expect(life(c)).toBeCloseTo(0.5);
  });

  it("applies the age share to a link that has never been shown", () => {
    // No snoozes and no ignores means never shown, which stops decideExpiry's age rule.
    // The countdown still runs.
    expect(life(candidate({ savedDaysAgo: 90 }))).toBeCloseTo(0.5);
  });

  it("takes the smallest of the three shares", () => {
    const c = candidate({ snoozeCount: 1, ignoredCount: 2, savedDaysAgo: 18 });
    // snoozes 0.8, ignored 1/3, age 0.9
    expect(life(c)).toBeCloseTo(1 / 3);
  });

  it("follows the user's own limits", () => {
    const strict = { ...SETTINGS, expiryMaxSnoozes: 2 };
    expect(life(candidate({ snoozeCount: 1 }), strict)).toBeCloseTo(0.5);
  });

  it("never goes below 0, even past every limit", () => {
    expect(life(candidate({ snoozeCount: 9 }))).toBe(0);
    expect(life(candidate({ savedDaysAgo: 400 }))).toBe(0);
  });

  it("never goes above 1, even with a save date in the future", () => {
    expect(life(candidate({ savedDaysAgo: -10 }))).toBe(1);
  });

  it("treats a limit of zero as already used up", () => {
    expect(life(candidate(), { ...SETTINGS, expiryMaxIgnored: 0 })).toBe(0);
  });

  it("works with the default settings", () => {
    expect(life(candidate({ snoozeCount: 1 }), DEFAULT_EXPIRY)).toBeCloseTo(0.8);
  });
});
