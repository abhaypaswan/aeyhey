// SPDX-License-Identifier: AGPL-3.0-only
// Builds the channel list from the environment, once per process.
//
// A channel the operator has not configured is simply absent, which is why the reminder
// loop never has to ask "is email set up" and the Settings screen can say "add SMTP_URL
// to turn this on".

import type { DbHandle } from "../db/client";
import type { Env } from "../env";
import { telegramWebhookSecret } from "../security/tokens";
import { createEmailChannel } from "./email/index";
import { createPushChannel, ensureVapidKeys, type VapidKeys } from "./push";
import { createTelegramChannel } from "./telegram/index";
import type { NotificationChannel } from "./types";
import type { NativePushSender } from "../extensions/push-sender";

export interface BuiltChannels {
  channels: NotificationChannel[];
  vapid: VapidKeys | null;
  byId: Map<string, NotificationChannel>;
}

export async function buildChannels(input: {
  handle: DbHandle;
  env: Env;
  appSecret: string;
  /** The registry's NativePushSender, so reminders reach phone apps too. */
  pushSender?: NativePushSender | null;
}): Promise<BuiltChannels> {
  const { handle, env, appSecret } = input;

  // Push is the only channel that works with no operator setup at all, because the keys
  // can be generated. So it is always built.
  const vapid = await ensureVapidKeys({
    dataDir: env.DATA_DIR,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  }).catch(() => null);

  const channels: NotificationChannel[] = [
    createPushChannel({
      handle,
      vapid,
      publicUrl: env.PUBLIC_URL,
      nativeSender: input.pushSender ?? null,
    }),
    createTelegramChannel({
      handle,
      botToken: env.TELEGRAM_BOT_TOKEN,
      publicUrl: env.PUBLIC_URL,
      webhookSecret: telegramWebhookSecret(appSecret, env.TELEGRAM_WEBHOOK_SECRET),
      mode: env.TELEGRAM_MODE,
    }),
    createEmailChannel({
      handle,
      smtpUrl: env.SMTP_URL,
      from: env.EMAIL_FROM,
      publicUrl: env.PUBLIC_URL,
      appSecret,
    }),
  ];

  return {
    channels,
    vapid,
    byId: new Map(channels.map((channel) => [channel.id, channel])),
  };
}
