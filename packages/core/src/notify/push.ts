// SPDX-License-Identifier: AGPL-3.0-only
// Web push (PRD 14.2).
//
// VAPID keys are generated on first run if missing and saved to DATA_DIR/secrets.json, so
// a self-hoster never has to know what VAPID is.
//
// Subscriptions die quietly: a browser that has been uninstalled returns 404 or 410, and
// that subscription is deleted rather than retried forever. Other failures are counted and
// the subscription is disabled after five, because a subscription that always fails is
// just noise in the logs.

import { and, eq, lt } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { newId } from "../ids";
import { saveGeneratedSecrets, readSecretsFile } from "../security/crypto";
import {
  summarizeForNotification,
  type DeliveryPayload,
  type DeliveryResult,
  type NotificationChannel,
} from "./types";
import { listDevices } from "./devices";
import type { NativePushResult, NativePushSender } from "../extensions/push-sender";
import { createLogger } from "../logger";

const log = createLogger("push");

/** After this many consecutive failures, stop trying this subscription. */
export const MAX_PUSH_FAILURES = 5;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Returns the VAPID keys, generating and persisting a pair on first run (PRD 14.2).
 * Env values win and are never written to disk.
 */
export async function ensureVapidKeys(input: {
  dataDir: string;
  publicKey?: string | undefined;
  privateKey?: string | undefined;
  subject: string;
}): Promise<VapidKeys> {
  if (input.publicKey && input.privateKey) {
    return { publicKey: input.publicKey, privateKey: input.privateKey, subject: input.subject };
  }

  const existing = readSecretsFile(input.dataDir);
  if (existing?.vapidPublicKey && existing.vapidPrivateKey) {
    return {
      publicKey: existing.vapidPublicKey,
      privateKey: existing.vapidPrivateKey,
      subject: input.subject,
    };
  }

  const webpush = await import("web-push");
  const generated = webpush.generateVAPIDKeys();
  saveGeneratedSecrets(input.dataDir, {
    vapidPublicKey: generated.publicKey,
    vapidPrivateKey: generated.privateKey,
  });

  log.info("generated a VAPID key pair and saved it to the data directory");
  return {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: input.subject,
  };
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

export async function savePushSubscription(
  handle: DbHandle,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const { pushSubscriptions } = handle.schema;

  await handle.db
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
      failCount: 0,
      lastOkAt: null,
      createdAt: new Date(),
    })
    // Re-subscribing the same browser updates the keys rather than adding a second row.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        failCount: 0,
      },
    });
}

export async function deletePushSubscription(
  handle: DbHandle,
  userId: string,
  endpoint: string,
): Promise<void> {
  const { pushSubscriptions } = handle.schema;
  await handle.db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function listPushSubscriptions(handle: DbHandle, userId: string) {
  const { pushSubscriptions } = handle.schema;
  return handle.db
    .select()
    .from(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, userId), lt(pushSubscriptions.failCount, MAX_PUSH_FAILURES)),
    );
}

export interface PushChannelOptions {
  handle: DbHandle;
  vapid: VapidKeys | null;
  publicUrl: string;
  /** Sends to phone apps. Null when no plugin provides one. */
  nativeSender?: NativePushSender | null;
}

interface PushNotification {
  title: string;
  body: string;
  /** A path such as "/session". Browsers get it made absolute, apps get it as is. */
  path: string;
  tag?: string;
}

/**
 * One channel, two kinds of target: browsers through web push and phones through the
 * registered NativePushSender. They share one on/off switch in Settings because to the
 * person they are the same thing, a notification on their device.
 */
export function createPushChannel(options: PushChannelOptions): NotificationChannel {
  const { handle } = options;
  const { pushSubscriptions, devices } = handle.schema;
  const nativeSender = options.nativeSender ?? null;

  async function sendWeb(
    subscriptions: Awaited<ReturnType<typeof listPushSubscriptions>>,
    notification: PushNotification,
  ): Promise<number> {
    if (!options.vapid) return 0;
    const webpush = await import("web-push");
    webpush.setVapidDetails(
      options.vapid.subject,
      options.vapid.publicKey,
      options.vapid.privateKey,
    );

    const body = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: `${options.publicUrl}${notification.path}`,
      ...(notification.tag ? { tag: notification.tag } : {}),
    });
    let sent = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
        );
        sent += 1;
        await handle.db
          .update(pushSubscriptions)
          .set({ failCount: 0, lastOkAt: new Date() })
          .where(eq(pushSubscriptions.id, subscription.id));
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        // 404 and 410 mean the browser is gone for good. Keeping the row would mean
        // failing forever (PRD 14.2).
        if (status === 404 || status === 410) {
          await handle.db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, subscription.id));
          log.info("removed a subscription the browser no longer has", { status });
          continue;
        }

        const failCount = subscription.failCount + 1;
        await handle.db
          .update(pushSubscriptions)
          .set({ failCount })
          .where(eq(pushSubscriptions.id, subscription.id));

        if (failCount >= MAX_PUSH_FAILURES) {
          log.warn("disabling a push subscription after repeated failures", { failCount });
        }
      }
    }
    return sent;
  }

  async function sendNative(
    phones: Awaited<ReturnType<typeof listDevices>>,
    notification: PushNotification,
  ): Promise<number> {
    if (!nativeSender) return 0;

    let results: NativePushResult[];
    try {
      results = await nativeSender.send(
        phones.map((phone) => ({
          id: phone.id,
          platform: phone.platform,
          pushToken: phone.pushToken,
        })),
        {
          title: notification.title,
          body: notification.body,
          path: notification.path,
          ...(notification.tag ? { tag: notification.tag } : {}),
        },
      );
    } catch (error) {
      // A sender that throws outright has failed every device, not just one.
      log.warn("the native push sender failed", {
        sender: nativeSender.id,
        error: (error as Error).message,
      });
      results = phones.map((phone) => ({ deviceId: phone.id, ok: false }));
    }

    let sent = 0;
    for (const phone of phones) {
      const result = results.find((candidate) => candidate.deviceId === phone.id);
      if (result?.ok) {
        sent += 1;
        await handle.db
          .update(devices)
          .set({ failCount: 0, lastOkAt: new Date() })
          .where(eq(devices.id, phone.id));
      } else if (result?.gone) {
        await handle.db.delete(devices).where(eq(devices.id, phone.id));
        log.info("removed a device the push service no longer knows", {
          sender: nativeSender.id,
        });
      } else {
        await handle.db
          .update(devices)
          .set({ failCount: phone.failCount + 1 })
          .where(eq(devices.id, phone.id));
      }
    }
    return sent;
  }

  async function send(userId: string, notification: PushNotification): Promise<DeliveryResult> {
    if (!options.vapid && !nativeSender) {
      return { ok: false, error: "Push is not set up on this instance." };
    }

    const subscriptions = options.vapid ? await listPushSubscriptions(handle, userId) : [];
    const phones = nativeSender ? await listDevices(handle, userId) : [];
    if (subscriptions.length === 0 && phones.length === 0) {
      return { ok: false, error: "No device is subscribed to push." };
    }

    const sent =
      (await sendWeb(subscriptions, notification)) + (await sendNative(phones, notification));

    return sent > 0
      ? { ok: true, messagesSent: sent }
      : { ok: false, error: "Every push subscription failed." };
  }

  return {
    id: "push",

    isConfigured() {
      return options.vapid !== null || nativeSender !== null;
    },

    async isEnabledFor(userId) {
      if (options.vapid && (await listPushSubscriptions(handle, userId)).length > 0) return true;
      return nativeSender !== null && (await listDevices(handle, userId)).length > 0;
    },

    async deliver(payload: DeliveryPayload) {
      const { title, body } = summarizeForNotification(payload.items);
      return send(payload.userId, {
        title,
        body,
        path: "/session",
        // One tag per session, so a second notification replaces the first rather than
        // stacking up on the lock screen.
        tag: `aeyhey-session-${payload.sessionId}`,
      });
    },

    async sendTest(userId) {
      return send(userId, {
        title: "Aeyhey is set up",
        body: "This is a test notification. Reminders will look like this.",
        path: "/",
        tag: "aeyhey-test",
      });
    },
  };
}
