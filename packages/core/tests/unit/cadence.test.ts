// SPDX-License-Identifier: AGPL-3.0-only
// Cadence (PRD 9.2, 14.1).
//
// These tests use real timezones with real offsets, including one that observes DST and
// one on a half-hour offset, because a mistake here means reminders arrive at the wrong
// time of day and the user never finds out why.

import { describe, expect, it } from "vitest";
import {
  LAST_DAY_OF_MONTH,
  CADENCE_WINDOW_DAYS,
  cadenceWindowMs,
  currentSlot,
  deferPastQuietHours,
  describeNextSession,
  eligibilityWindow,
  inQuietHours,
  isPaused,
  nextSlot,
  type CadenceSettings,
} from "../../src/scheduler/cadence";

const daily = (overrides: Partial<CadenceSettings> = {}): CadenceSettings => ({
  cadence: "daily",
  cadenceWeekdays: [1],
  cadenceDayOfMonth: 1,
  sendTime: "09:00",
  timezone: "UTC",
  quietHours: null,
  pausedUntil: null,
  ...overrides,
});

describe("the cadence window", () => {
  it("is 0 for daily, 6 days for weekly, 27 for monthly", () => {
    expect(CADENCE_WINDOW_DAYS.daily).toBe(0);
    expect(CADENCE_WINDOW_DAYS.weekly).toBe(6);
    expect(CADENCE_WINDOW_DAYS.monthly).toBe(27);
    expect(cadenceWindowMs("weekly")).toBe(6 * 86_400_000);
  });

  it("lets a weekly user see cards that come due during the week", () => {
    const now = new Date("2026-06-01T09:00:00Z");
    const window = eligibilityWindow(now, daily({ cadence: "weekly" }));
    expect(window.until.getTime() - now.getTime()).toBe(6 * 86_400_000);
    expect(window.nextSessionAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("the send slot, in the user's own timezone", () => {
  it("fires at 09:00 local in UTC", () => {
    const slot = nextSlot(new Date("2026-06-01T08:00:00Z"), daily());
    expect(slot.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("fires at 09:00 local in New York, which is 13:00 UTC in summer", () => {
    const slot = nextSlot(
      new Date("2026-06-01T06:00:00Z"),
      daily({ timezone: "America/New_York" }),
    );
    expect(slot.toISOString()).toBe("2026-06-01T13:00:00.000Z");
  });

  it("follows the clocks changing, without being told", () => {
    // New York is UTC-5 in winter and UTC-4 in summer. Same 09:00 to the user.
    const winter = nextSlot(
      new Date("2026-01-15T06:00:00Z"),
      daily({ timezone: "America/New_York" }),
    );
    expect(winter.toISOString()).toBe("2026-01-15T14:00:00.000Z");

    const summer = nextSlot(
      new Date("2026-07-15T06:00:00Z"),
      daily({ timezone: "America/New_York" }),
    );
    expect(summer.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("handles a half-hour offset", () => {
    // Kolkata is UTC+5:30, so 09:00 local is 03:30 UTC.
    const slot = nextSlot(new Date("2026-06-01T00:00:00Z"), daily({ timezone: "Asia/Kolkata" }));
    expect(slot.toISOString()).toBe("2026-06-01T03:30:00.000Z");
  });

  it("moves to tomorrow once today's slot has passed", () => {
    const slot = nextSlot(new Date("2026-06-01T10:00:00Z"), daily());
    expect(slot.toISOString()).toBe("2026-06-02T09:00:00.000Z");
  });

  it("reports the slot that has already passed today", () => {
    const slot = currentSlot(new Date("2026-06-01T10:00:00Z"), daily());
    expect(slot?.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("reports yesterday's slot before today's has arrived", () => {
    const slot = currentSlot(new Date("2026-06-01T08:00:00Z"), daily());
    expect(slot?.toISOString()).toBe("2026-05-31T09:00:00.000Z");
  });
});

describe("weekly and monthly cadences", () => {
  it("only fires on the chosen weekday", () => {
    // 2026-06-01 is a Monday.
    const settings = daily({ cadence: "weekly", cadenceWeekdays: [1] });

    expect(nextSlot(new Date("2026-06-01T08:00:00Z"), settings).toISOString()).toBe(
      "2026-06-01T09:00:00.000Z",
    );
    // From Monday afternoon, the next one is the following Monday.
    expect(nextSlot(new Date("2026-06-01T10:00:00Z"), settings).toISOString()).toBe(
      "2026-06-08T09:00:00.000Z",
    );
  });

  it("supports more than one weekday", () => {
    // Monday and Thursday.
    const settings = daily({ cadence: "weekly", cadenceWeekdays: [1, 4] });
    expect(nextSlot(new Date("2026-06-01T10:00:00Z"), settings).toISOString()).toBe(
      "2026-06-04T09:00:00.000Z",
    );
  });

  it("fires on the chosen day of the month", () => {
    const settings = daily({ cadence: "monthly", cadenceDayOfMonth: 15 });
    expect(nextSlot(new Date("2026-06-01T10:00:00Z"), settings).toISOString()).toBe(
      "2026-06-15T09:00:00.000Z",
    );
    expect(nextSlot(new Date("2026-06-20T10:00:00Z"), settings).toISOString()).toBe(
      "2026-07-15T09:00:00.000Z",
    );
  });

  it("caps the day of the month at 28, so every month has one", () => {
    const settings = daily({ cadence: "monthly", cadenceDayOfMonth: 31 });
    const slot = nextSlot(new Date("2026-02-01T10:00:00Z"), settings);
    // February has no 31st, so the cap means the user still hears from us.
    expect(slot.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });
});

describe("the last day of the month", () => {
  const last = daily({ cadence: "monthly", cadenceDayOfMonth: LAST_DAY_OF_MONTH });

  it("lands on the 30th, 31st or 28th, whichever ends the month", () => {
    expect(nextSlot(new Date("2026-06-01T10:00:00Z"), last).toISOString()).toBe(
      "2026-06-30T09:00:00.000Z",
    );
    expect(nextSlot(new Date("2026-06-30T10:00:00Z"), last).toISOString()).toBe(
      "2026-07-31T09:00:00.000Z",
    );
    expect(nextSlot(new Date("2026-01-31T10:00:00Z"), last).toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    // A leap year gets the 29th.
    expect(nextSlot(new Date("2028-02-01T10:00:00Z"), last).toISOString()).toBe(
      "2028-02-29T09:00:00.000Z",
    );
  });

  it("counts the last day as the current slot, and no other day", () => {
    expect(currentSlot(new Date("2026-07-05T10:00:00Z"), last)?.toISOString()).toBe(
      "2026-06-30T09:00:00.000Z",
    );
  });
});

describe("quiet hours", () => {
  it("knows when it is inside a normal range", () => {
    const settings = daily({ quietHours: { start: "22:00", end: "07:00" } });
    expect(inQuietHours(new Date("2026-06-01T23:00:00Z"), settings)).toBe(true);
    expect(inQuietHours(new Date("2026-06-01T03:00:00Z"), settings)).toBe(true);
    expect(inQuietHours(new Date("2026-06-01T12:00:00Z"), settings)).toBe(false);
  });

  it("handles a range that does not wrap midnight", () => {
    const settings = daily({ quietHours: { start: "09:00", end: "17:00" } });
    expect(inQuietHours(new Date("2026-06-01T12:00:00Z"), settings)).toBe(true);
    expect(inQuietHours(new Date("2026-06-01T20:00:00Z"), settings)).toBe(false);
  });

  it("reads quiet hours in the user's timezone, not the server's", () => {
    const settings = daily({
      timezone: "Asia/Kolkata",
      quietHours: { start: "22:00", end: "07:00" },
    });
    // 18:00 UTC is 23:30 in Kolkata, so it is quiet there even though it is evening in UTC.
    expect(inQuietHours(new Date("2026-06-01T18:00:00Z"), settings)).toBe(true);
    // 09:00 UTC is 14:30 in Kolkata, which is the middle of the day.
    expect(inQuietHours(new Date("2026-06-01T09:00:00Z"), settings)).toBe(false);
  });

  it("is never inside quiet hours when none are set", () => {
    expect(inQuietHours(new Date(), daily())).toBe(false);
  });

  it("pushes a send to just after quiet hours end, rather than dropping it", () => {
    const settings = daily({ quietHours: { start: "22:00", end: "07:00" } });
    const deferred = deferPastQuietHours(new Date("2026-06-01T23:00:00Z"), settings);
    expect(inQuietHours(deferred, settings)).toBe(false);
    expect(deferred.getTime()).toBeGreaterThan(new Date("2026-06-01T23:00:00Z").getTime());
  });
});

describe("pausing", () => {
  it("is paused until the date passes", () => {
    const now = new Date("2026-06-01T09:00:00Z");
    expect(isPaused(now, daily({ pausedUntil: new Date("2026-06-08T09:00:00Z") }))).toBe(true);
    expect(isPaused(now, daily({ pausedUntil: new Date("2026-05-25T09:00:00Z") }))).toBe(false);
    expect(isPaused(now, daily())).toBe(false);
  });
});

describe("describeNextSession", () => {
  it("says the time in the user's own clock, not UTC", () => {
    // This is the regression: reading a zoned Date with getUTCHours reported 09:00 as
    // 03:30 for a user in Kolkata.
    expect(
      describeNextSession(new Date("2026-06-01T00:00:00Z"), daily({ timezone: "Asia/Kolkata" })),
    ).toBe("Today at 09:00");

    expect(
      describeNextSession(
        new Date("2026-06-01T06:00:00Z"),
        daily({ timezone: "America/New_York" }),
      ),
    ).toBe("Today at 09:00");

    expect(describeNextSession(new Date("2026-06-01T08:00:00Z"), daily())).toBe("Today at 09:00");
  });

  it("says tomorrow once today's slot has gone", () => {
    expect(describeNextSession(new Date("2026-06-01T10:00:00Z"), daily())).toBe(
      "Tomorrow at 09:00",
    );
  });

  it("adds the date once the slot is a week or more away", () => {
    const settings = daily({ cadence: "monthly", cadenceDayOfMonth: 1 });
    // From 15 November 2026, the 1st is a Tuesday two weeks out, not this Tuesday.
    expect(describeNextSession(new Date("2026-11-15T10:00:00Z"), settings)).toBe(
      "Tuesday 1 December at 09:00",
    );
  });

  it("names the weekday for anything further out", () => {
    const settings = daily({ cadence: "weekly", cadenceWeekdays: [4] });
    // From Monday, the next Thursday.
    expect(describeNextSession(new Date("2026-06-01T10:00:00Z"), settings)).toBe(
      "Thursday at 09:00",
    );
  });

  it("uses no em dashes", () => {
    const dashes = new RegExp("[\\u2013\\u2014]");
    expect(describeNextSession(new Date(), daily())).not.toMatch(dashes);
  });
});
