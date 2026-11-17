// SPDX-License-Identifier: AGPL-3.0-only
// The reminder loop (PRD 14.1).
//
// Runs every minute in the worker. For each user it works out the current send slot from
// their cadence, time of day, timezone and quiet hours, and if that slot has passed with
// no notification recorded, it builds one session and hands it to every channel they have
// enabled.
//
// Two decisions worth knowing about:
//
//   1. The session is built once, not once per channel. Otherwise push, Telegram and email
//      could each build a different set of cards and the user would see three different
//      "5 cards" that disagree.
//   2. Zero cards means nothing is sent. A reminder that says "nothing to do" is the fastest
//      way to get a notification channel muted.
//
// The unique key on notifications(user, channel, slot) is what makes this idempotent
// across restarts: a worker that dies mid-send cannot double-send on the way back up.

import { eq } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { newId } from "../ids";
import { scopeFor } from "../repos/context";
import { loadSettings, toCadenceSettings } from "../repos/settings";
import { currentSlot, inQuietHours, isPaused } from "../scheduler/cadence";
import { getOrBuildSession } from "../sessions/service";
import type { Channel } from "../db/types";
import type { DeliveryPayload, NotificationChannel } from "./types";
import { createLogger } from "../logger";

const log = createLogger("reminders");

export interface ReminderLoopOptions {
  handle: DbHandle;
  channels: NotificationChannel[];
  publicUrl: string;
  now?: Date;
}

export interface ReminderLoopResult {
  usersChecked: number;
  sessionsBuilt: number;
  delivered: { channel: Channel; userId: string; ok: boolean; error?: string }[];
  skipped: { userId: string; reason: string }[];
}

/**
 * Claims a (user, channel, slot) before sending. Returns false when another worker, or an
 * earlier run, already has it. This is the idempotency check, and it is a database
 * constraint rather than an in-memory flag on purpose.
 */
async function claimSlot(
  handle: DbHandle,
  input: { userId: string; channel: Channel; slotTime: Date; sessionId: string },
): Promise<boolean> {
  const { notifications } = handle.schema;

  try {
    const inserted = await handle.db
      .insert(notifications)
      .values({
        id: newId(),
        userId: input.userId,
        channel: input.channel,
        slotTime: input.slotTime,
        sessionId: input.sessionId,
        status: "queued",
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });

    return inserted.length > 0;
  } catch (error) {
    // A unique violation here is the expected outcome of a race, not a problem.
    log.debug("could not claim a send slot", { error: (error as Error).message });
    return false;
  }
}

async function markSent(
  handle: DbHandle,
  input: { userId: string; channel: Channel; slotTime: Date; ok: boolean; error?: string },
): Promise<void> {
  const { notifications } = handle.schema;
  const { and } = await import("drizzle-orm");

  await handle.db
    .update(notifications)
    .set({
      status: input.ok ? "sent" : "failed",
      error: input.error?.slice(0, 1000) ?? null,
      sentAt: input.ok ? new Date() : null,
    })
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.channel, input.channel),
        eq(notifications.slotTime, input.slotTime),
      ),
    );
}

export async function runReminderLoop(options: ReminderLoopOptions): Promise<ReminderLoopResult> {
  const { handle, channels } = options;
  const now = options.now ?? new Date();
  const { users } = handle.schema;

  const result: ReminderLoopResult = {
    usersChecked: 0,
    sessionsBuilt: 0,
    delivered: [],
    skipped: [],
  };

  const configured = channels.filter((channel) => channel.isConfigured());
  if (configured.length === 0) return result;

  // The loop iterates every user, which is what makes the community code multi-user
  // correct even though it ships single-user (PRD 23.7).
  const allUsers = await handle.db.select({ id: users.id }).from(users);

  for (const user of allUsers) {
    result.usersChecked += 1;
    const scope = scopeFor(handle, user.id);

    let settings;
    try {
      settings = await loadSettings(scope);
    } catch (error) {
      result.skipped.push({ userId: user.id, reason: (error as Error).message });
      continue;
    }

    const cadence = toCadenceSettings(settings);

    if (isPaused(now, cadence)) {
      result.skipped.push({ userId: user.id, reason: "paused" });
      continue;
    }
    if (inQuietHours(now, cadence)) {
      // Not an error: the slot stays unclaimed and this runs again in a minute.
      result.skipped.push({ userId: user.id, reason: "quiet hours" });
      continue;
    }

    const slot = currentSlot(now, cadence);
    if (!slot) {
      result.skipped.push({ userId: user.id, reason: "no send slot has passed yet" });
      continue;
    }

    // Which channels are both configured and turned on for this user.
    const enabled: NotificationChannel[] = [];
    for (const channel of configured) {
      if (await channel.isEnabledFor(user.id)) enabled.push(channel);
    }
    if (enabled.length === 0) {
      result.skipped.push({ userId: user.id, reason: "no channel enabled" });
      continue;
    }

    // Built once, shared by every channel.
    const payload = await getOrBuildSession(scope, { trigger: "scheduled", now });

    if (!payload.session || payload.items.length === 0) {
      result.skipped.push({ userId: user.id, reason: payload.emptyReason ?? "nothing due" });
      continue;
    }
    result.sessionsBuilt += 1;

    const delivery: DeliveryPayload = {
      userId: user.id,
      sessionId: payload.session.id,
      items: payload.items,
      nextSessionLabel: payload.nextSessionLabel,
      publicUrl: options.publicUrl,
      expiredSinceLast: 0,
    };

    for (const channel of enabled) {
      const claimed = await claimSlot(handle, {
        userId: user.id,
        channel: channel.id,
        slotTime: slot,
        sessionId: payload.session.id,
      });
      // Already sent for this slot, by this run or a previous one.
      if (!claimed) continue;

      try {
        const outcome = await channel.deliver(delivery);
        await markSent(handle, {
          userId: user.id,
          channel: channel.id,
          slotTime: slot,
          ok: outcome.ok,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
        result.delivered.push({
          channel: channel.id,
          userId: user.id,
          ok: outcome.ok,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      } catch (error) {
        const message = (error as Error).message;
        await markSent(handle, {
          userId: user.id,
          channel: channel.id,
          slotTime: slot,
          ok: false,
          error: message,
        });
        result.delivered.push({
          channel: channel.id,
          userId: user.id,
          ok: false,
          error: message,
        });
        log.error("a channel threw while delivering", { channel: channel.id, error: message });
      }
    }
  }

  if (result.sessionsBuilt > 0 || result.delivered.length > 0) {
    log.info("reminder loop ran", {
      usersChecked: result.usersChecked,
      sessionsBuilt: result.sessionsBuilt,
      delivered: result.delivered.length,
    });
  }

  return result;
}
