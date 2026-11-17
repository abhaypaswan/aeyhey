// SPDX-License-Identifier: AGPL-3.0-only
// send_reminder: deliver one session to one channel (PRD 14.1).
//
// The reminder loop normally delivers inline, since the channels are quick. This handler
// exists for the retry path: a channel that failed is re-queued as a job so it backs off
// rather than being retried every minute by the loop.

import { scopeFor } from "../../repos/context";
import { loadCardViews } from "../../sessions/views";
import { describeNextSession } from "../../scheduler/cadence";
import { loadSettings, toCadenceSettings } from "../../repos/settings";
import { buildChannels } from "../../notify/channels";
import { requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:send_reminder");

export async function sendReminderHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const sessionId = requireString(ctx.job.payload, "sessionId");
  const channelId = requireString(ctx.job.payload, "channel");
  const scope = scopeFor(ctx.handle, userId);

  const { sessionItems } = ctx.handle.schema;
  const { and, eq } = await import("drizzle-orm");

  const items = await ctx.handle.db
    .select({ cardId: sessionItems.cardId })
    .from(sessionItems)
    .where(
      and(
        eq(sessionItems.userId, userId),
        eq(sessionItems.sessionId, sessionId),
        eq(sessionItems.status, "pending"),
      ),
    )
    .orderBy(sessionItems.position);

  if (items.length === 0) {
    // The user already did the session. Sending it now would be noise.
    log.info("nothing left in that session, not sending", { sessionId });
    return;
  }

  const built = await buildChannels({
    handle: ctx.handle,
    env: ctx.env,
    appSecret: ctx.appSecret,
    pushSender: ctx.registry.pushSender,
  });
  const channel = built.byId.get(channelId);

  if (!channel || !channel.isConfigured()) {
    log.info("channel is not configured, dropping the reminder", { channelId });
    return;
  }

  const settings = await loadSettings(scope);
  const views = await loadCardViews(
    scope,
    items.map((item) => item.cardId),
  );

  const result = await channel.deliver({
    userId,
    sessionId,
    items: views,
    nextSessionLabel: describeNextSession(new Date(), toCadenceSettings(settings)),
    publicUrl: ctx.env.PUBLIC_URL,
    expiredSinceLast: 0,
  });

  // Throwing puts the job through the normal backoff rather than silently giving up.
  if (!result.ok) throw new Error(result.error ?? `The ${channelId} channel did not deliver.`);
}
