// SPDX-License-Identifier: AGPL-3.0-only
// Settings storage, scoped by user (PRD 8.4, 10).

import { eq } from "drizzle-orm";
import type { Cadence, MixMode, QuietHours } from "../db/types";
import type { CadenceSettings } from "../scheduler/cadence";
import { DEFAULT_EXPIRY, type ExpirySettings } from "../scheduler/expiry";
import type { SessionSettings } from "../scheduler/session-builder";
import type { Scope } from "./context";

export interface SettingsRow {
  userId: string;
  cadence: Cadence;
  cadenceWeekdays: number[];
  cadenceDayOfMonth: number;
  sendTime: string;
  quietHours: QuietHours | null;
  cardsPerSession: number;
  mixMode: MixMode;
  mixLinks: number;
  mixQuestions: number;
  maxNewQuestions: number;
  maxNewLinks: number;
  requestRetention: number;
  expiryEnabled: boolean;
  expiryMaxSnoozes: number;
  expiryMaxIgnored: number;
  expiryUnreadDays: number;
  stripPii: boolean;
  pausedUntil: Date | null;
  timezone: string;
}

/**
 * Settings plus the timezone, which lives on the user row because it is identity rather
 * than preference. Everything that schedules needs both, so they are read together.
 */
export async function loadSettings(scope: Scope): Promise<SettingsRow> {
  const { settings, users } = scope.handle.schema;

  const rows = await scope.handle.db
    .select({ settings, timezone: users.timezone })
    .from(settings)
    .innerJoin(users, eq(users.id, settings.userId))
    .where(eq(settings.userId, scope.userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(
      `No settings row for user ${scope.userId}. Every user gets one at sign-up, so this means the account was created outside the normal path.`,
    );
  }

  return { ...row.settings, timezone: row.timezone };
}

/**
 * Only the expiry settings, for code that annotates links with how close they are to
 * expiring. One read per request, never per row. A user with no settings row is one the
 * expire_links job skips, so expiry is reported as off for them rather than throwing.
 */
export async function loadExpirySettings(scope: Scope): Promise<ExpirySettings> {
  const { settings } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({
      expiryEnabled: settings.expiryEnabled,
      expiryMaxSnoozes: settings.expiryMaxSnoozes,
      expiryMaxIgnored: settings.expiryMaxIgnored,
      expiryUnreadDays: settings.expiryUnreadDays,
    })
    .from(settings)
    .where(eq(settings.userId, scope.userId))
    .limit(1);
  return rows[0] ?? { ...DEFAULT_EXPIRY, expiryEnabled: false };
}

export type SettingsPatch = Partial<Omit<SettingsRow, "userId" | "timezone">> & {
  timezone?: string;
};

export async function updateSettings(scope: Scope, patch: SettingsPatch): Promise<void> {
  const { settings, users } = scope.handle.schema;
  const { timezone, ...rest } = patch;

  if (Object.keys(rest).length > 0) {
    await scope.handle.db
      .update(settings)
      .set({ ...rest, updatedAt: new Date() })
      .where(eq(settings.userId, scope.userId));
  }

  if (timezone) {
    await scope.handle.db.update(users).set({ timezone }).where(eq(users.id, scope.userId));
  }
}

/** The three views the scheduler modules want, so neither has to know the row shape. */
export function toCadenceSettings(row: SettingsRow): CadenceSettings {
  return {
    cadence: row.cadence,
    cadenceWeekdays: row.cadenceWeekdays,
    cadenceDayOfMonth: row.cadenceDayOfMonth,
    sendTime: row.sendTime,
    timezone: row.timezone,
    quietHours: row.quietHours,
    pausedUntil: row.pausedUntil,
  };
}

export function toSessionSettings(row: SettingsRow): SessionSettings {
  return {
    cardsPerSession: row.cardsPerSession,
    mixMode: row.mixMode,
    mixLinks: row.mixLinks,
    mixQuestions: row.mixQuestions,
    maxNewQuestions: row.maxNewQuestions,
    maxNewLinks: row.maxNewLinks,
    requestRetention: row.requestRetention,
  };
}

export function toExpirySettings(row: SettingsRow): ExpirySettings {
  return {
    expiryEnabled: row.expiryEnabled,
    expiryMaxSnoozes: row.expiryMaxSnoozes,
    expiryMaxIgnored: row.expiryMaxIgnored,
    expiryUnreadDays: row.expiryUnreadDays,
  };
}

/**
 * An open-ended pause is stored as this far-off date, so every check that asks "is it
 * paused?" keeps working unchanged. Nothing shows the date: clients get pausedUntil null
 * with pausedIndefinitely true instead.
 */
export const PAUSED_INDEFINITELY = new Date("9999-12-31T00:00:00.000Z");

export function isPausedIndefinitely(until: Date | null | undefined): boolean {
  return Boolean(until && until.getTime() >= PAUSED_INDEFINITELY.getTime());
}

/** Settings as clients see them: an open-ended pause has no date, only the flag. */
export function publicSettings(row: SettingsRow): SettingsRow & { pausedIndefinitely: boolean } {
  const indefinitely = isPausedIndefinitely(row.pausedUntil);
  return {
    ...row,
    pausedUntil: indefinitely ? null : row.pausedUntil,
    pausedIndefinitely: indefinitely,
  };
}

/** Pauses until the user turns reminders back on. */
export async function pauseIndefinitely(scope: Scope): Promise<void> {
  await updateSettings(scope, { pausedUntil: PAUSED_INDEFINITELY });
}

/** "/pause" in Telegram lands here (PRD 12.2). */
export async function pauseFor(scope: Scope, days: number): Promise<Date> {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await updateSettings(scope, { pausedUntil: until });
  return until;
}

export async function resumeNow(scope: Scope): Promise<void> {
  await updateSettings(scope, { pausedUntil: null });
}
