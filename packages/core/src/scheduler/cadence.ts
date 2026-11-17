// SPDX-License-Identifier: AGPL-3.0-only
// Cadence: when the user is asked (PRD 9.2, 14.1).
//
// FSRS decides what is due. Cadence decides when the user hears about it. The two meet
// through the cadence window: a card counts as eligible if it comes due before the next
// session, so a weekly user is not nagged mid-week and does not miss a card either.

import { addDays, addMinutes, addMonths, getDaysInMonth, setDate, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Cadence, QuietHours } from "../db/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** cadenceDayOfMonth for "the last day of the month", counted from the end like L in cron. */
export const LAST_DAY_OF_MONTH = -1;

/** The day of the month a monthly reminder lands on, in the month `localDay` is in. */
function monthlyDay(localDay: Date, setting: number): number {
  if (setting === LAST_DAY_OF_MONTH) return getDaysInMonth(localDay);
  return Math.min(28, Math.max(1, setting));
}

export interface CadenceSettings {
  cadence: Cadence;
  /** 0 is Sunday, matching getDay(). */
  cadenceWeekdays: number[];
  /**
   * 1 to 28, so every month has the day, or LAST_DAY_OF_MONTH (-1) for the 28th, 29th,
   * 30th or 31st, whichever ends that month.
   */
  cadenceDayOfMonth: number;
  /** "HH:mm" in the user's own timezone. */
  sendTime: string;
  timezone: string;
  quietHours?: QuietHours | null;
  pausedUntil?: Date | null;
}

/** How far past "now" a card may be due and still make it into this session. */
export const CADENCE_WINDOW_DAYS: Record<Cadence, number> = {
  daily: 0,
  weekly: 6,
  monthly: 27,
};

export function cadenceWindowMs(cadence: Cadence): number {
  return CADENCE_WINDOW_DAYS[cadence] * DAY_MS;
}

function parseHhMm(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return { hours: 9, minutes: 0 };
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return { hours, minutes };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * date-fns-tz's toZonedTime returns a Date whose LOCAL getters read as the wall clock in
 * the target zone. So every reader in this file uses getFullYear, getDate, getDay and
 * getHours, never the getUTC equivalents. Mixing the two double-shifts the time, which is
 * exactly the bug that made a 09:00 reminder report itself as 03:30 on a machine five and
 * a half hours ahead of UTC.
 */
function zonedParts(zoned: Date): { year: number; month: number; day: number } {
  return { year: zoned.getFullYear(), month: zoned.getMonth() + 1, day: zoned.getDate() };
}

/** Turns a local wall-clock day plus "HH:mm" into a real instant. */
function instantAt(localDay: Date, sendTime: string, timezone: string): Date {
  const { hours, minutes } = parseHhMm(sendTime);
  const { year, month, day } = zonedParts(startOfDay(localDay));
  // fromZonedTime reads this string as local time in the given zone, which is exactly the
  // promise made to the user: "09:00" means 09:00 where they are, DST included.
  return fromZonedTime(
    `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`,
    timezone,
  );
}

function isSendDay(localDay: Date, settings: CadenceSettings): boolean {
  switch (settings.cadence) {
    case "daily":
      return true;
    case "weekly": {
      const days = settings.cadenceWeekdays.length > 0 ? settings.cadenceWeekdays : [1];
      return days.includes(localDay.getDay());
    }
    case "monthly":
      return localDay.getDate() === monthlyDay(localDay, settings.cadenceDayOfMonth);
  }
}

/**
 * The most recent send slot at or before `now`, or null when there has not been one yet
 * (a brand new user whose first slot is still ahead).
 */
export function currentSlot(now: Date, settings: CadenceSettings): Date | null {
  const localNow = toZonedTime(now, settings.timezone);
  // 40 days back covers a monthly cadence plus a long outage.
  for (let back = 0; back <= 40; back += 1) {
    const localDay = startOfDay(addDays(localNow, -back));
    if (!isSendDay(localDay, settings)) continue;
    const slot = instantAt(localDay, settings.sendTime, settings.timezone);
    if (slot.getTime() <= now.getTime()) return slot;
  }
  return null;
}

/** The next send slot strictly after `now`. */
export function nextSlot(now: Date, settings: CadenceSettings): Date {
  const localNow = toZonedTime(now, settings.timezone);

  if (settings.cadence === "monthly") {
    for (let ahead = 0; ahead <= 2; ahead += 1) {
      // setDate(…, 1) first, so moving a 31st forward a month cannot spill into the next.
      const month = setDate(addMonths(setDate(localNow, 1), ahead), 1);
      const localDay = startOfDay(setDate(month, monthlyDay(month, settings.cadenceDayOfMonth)));
      const slot = instantAt(localDay, settings.sendTime, settings.timezone);
      if (slot.getTime() > now.getTime()) return slot;
    }
  }

  for (let ahead = 0; ahead <= 40; ahead += 1) {
    const localDay = startOfDay(addDays(localNow, ahead));
    if (!isSendDay(localDay, settings)) continue;
    const slot = instantAt(localDay, settings.sendTime, settings.timezone);
    if (slot.getTime() > now.getTime()) return slot;
  }

  // Unreachable with valid settings, but a sane answer beats a throw in the reminder loop.
  return new Date(now.getTime() + 7 * DAY_MS);
}

export function isPaused(now: Date, settings: CadenceSettings): boolean {
  return Boolean(settings.pausedUntil && settings.pausedUntil.getTime() > now.getTime());
}

/** Quiet hours may wrap past midnight, for example 22:00 to 07:00. */
export function inQuietHours(now: Date, settings: CadenceSettings): boolean {
  if (!settings.quietHours) return false;
  const local = toZonedTime(now, settings.timezone);
  const minutesNow = local.getHours() * 60 + local.getMinutes();
  const start = parseHhMm(settings.quietHours.start);
  const end = parseHhMm(settings.quietHours.end);
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;
  if (startMin === endMin) return false;
  return startMin < endMin
    ? minutesNow >= startMin && minutesNow < endMin
    : minutesNow >= startMin || minutesNow < endMin;
}

/** Pushes a send to just after quiet hours end rather than dropping it. */
export function deferPastQuietHours(at: Date, settings: CadenceSettings): Date {
  if (!settings.quietHours) return at;
  let candidate = at;
  for (let i = 0; i < 24 * 4 && inQuietHours(candidate, settings); i += 1) {
    candidate = addMinutes(candidate, 15);
  }
  return candidate;
}

export interface EligibilityWindow {
  now: Date;
  /** Cards due at or before this instant make it into the session. */
  until: Date;
  nextSessionAt: Date;
}

export function eligibilityWindow(now: Date, settings: CadenceSettings): EligibilityWindow {
  return {
    now,
    until: new Date(now.getTime() + cadenceWindowMs(settings.cadence)),
    nextSessionAt: nextSlot(now, settings),
  };
}

/**
 * For the Today screen: "Today at 09:00", "Tomorrow at 09:00", "Thursday at 09:00" within
 * the week, then "Tuesday 1 December at 09:00", so a monthly slot two weeks out is not
 * mistaken for this Tuesday.
 */
export function describeNextSession(now: Date, settings: CadenceSettings): string {
  const slot = nextSlot(now, settings);
  const local = toZonedTime(slot, settings.timezone);
  const localNow = toZonedTime(now, settings.timezone);
  const sameDay = startOfDay(local).getTime() === startOfDay(localNow).getTime();
  const time = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
  if (sameDay) return `Today at ${time}`;
  const tomorrow = startOfDay(addDays(localNow, 1)).getTime();
  if (startOfDay(local).getTime() === tomorrow) return `Tomorrow at ${time}`;
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    local.getDay()
  ];
  const daysAway = Math.round(
    (startOfDay(local).getTime() - startOfDay(localNow).getTime()) / DAY_MS,
  );
  if (daysAway < 7) return `${weekday} at ${time}`;
  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][local.getMonth()];
  return `${weekday} ${local.getDate()} ${month} at ${time}`;
}
