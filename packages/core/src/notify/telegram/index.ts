// SPDX-License-Identifier: AGPL-3.0-only
// The Telegram bot (PRD 12.2, 14.3).
//
// Webhook when PUBLIC_URL is https, long polling otherwise, because a home server has no
// public URL and polling works there with no setup at all.
//
// Security: every callback and every message is checked against the chat that the card's
// user owns. A chat id is not a secret, so the check is on every update, not just at link
// time.

import { and, eq, gt } from "drizzle-orm";
import type { Api as GrammyApi } from "grammy";
import type { DbHandle } from "../../db/client";
import { newId } from "../../ids";
import { newLinkCode, TEN_MINUTES_MS } from "../../security/tokens";
import { scopeFor } from "../../repos/context";
import { saveLinks } from "../../repos/links";
import { extractUrls } from "../../links/extract-urls";
import { enqueue } from "../../jobs/queue";
import {
  decodeCallback,
  renderLinkCard,
  renderQuestionCard,
  renderSessionHeader,
  type TelegramMessage,
} from "./format";
import {
  newQuestionsLine,
  type DeliveryPayload,
  type DeliveryResult,
  type NotificationChannel,
} from "../types";
import { createLogger } from "../../logger";

const log = createLogger("telegram");

export interface TelegramOptions {
  handle: DbHandle;
  botToken?: string | undefined;
  publicUrl: string;
  webhookSecret: string;
  mode: "webhook" | "polling" | "auto";
}

/** Which transport to use. Polling needs no public URL, which is the common home case. */
export function resolveTelegramMode(options: {
  mode: "webhook" | "polling" | "auto";
  publicUrl: string;
}): "webhook" | "polling" {
  if (options.mode !== "auto") return options.mode;
  return options.publicUrl.startsWith("https://") ? "webhook" : "polling";
}

// ---------------------------------------------------------------- account linking

export interface LinkCodeResult {
  code: string;
  deepLink: string;
  expiresAt: Date;
}

/** A one-time code, good for 10 minutes (PRD 14.3). */
export async function createLinkCode(
  options: TelegramOptions,
  userId: string,
  botUsername: string,
): Promise<LinkCodeResult> {
  const { telegramLinks } = options.handle.schema;
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + TEN_MINUTES_MS);

  await options.handle.db
    .insert(telegramLinks)
    .values({ userId, linkCode: code, linkCodeExpiresAt: expiresAt })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { linkCode: code, linkCodeExpiresAt: expiresAt },
    });

  return {
    code,
    deepLink: `https://t.me/${botUsername}?start=${code}`,
    expiresAt,
  };
}

export async function redeemLinkCode(
  handle: DbHandle,
  input: { code: string; chatId: string; username?: string },
): Promise<{ ok: boolean; userId?: string; reason?: string }> {
  const { telegramLinks } = handle.schema;

  const rows = await handle.db
    .select()
    .from(telegramLinks)
    .where(
      and(
        eq(telegramLinks.linkCode, input.code.trim().toUpperCase()),
        gt(telegramLinks.linkCodeExpiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: "That code is not valid, or it has expired." };

  await handle.db
    .update(telegramLinks)
    .set({
      chatId: input.chatId,
      username: input.username ?? null,
      linkedAt: new Date(),
      // Burn the code so it cannot link a second chat.
      linkCode: null,
      linkCodeExpiresAt: null,
    })
    .where(eq(telegramLinks.userId, row.userId));

  log.info("linked a telegram chat", { userId: row.userId });
  return { ok: true, userId: row.userId };
}

export async function findUserByChat(handle: DbHandle, chatId: string): Promise<string | null> {
  const { telegramLinks } = handle.schema;
  const rows = await handle.db
    .select({ userId: telegramLinks.userId })
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

export async function findChatForUser(handle: DbHandle, userId: string): Promise<string | null> {
  const { telegramLinks } = handle.schema;
  const rows = await handle.db
    .select()
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .limit(1);
  const row = rows[0];
  return row?.chatId && row.linkedAt ? row.chatId : null;
}

// ---------------------------------------------------------------- card lookup

/**
 * Resolves a shortened card id from callback data back to a real card, checking it
 * belongs to this chat's user. The ownership check is the security boundary here.
 */
export async function resolveCallbackCard(
  handle: DbHandle,
  input: { chatId: string; shortCardId: string },
): Promise<{ ok: true; userId: string; cardId: string } | { ok: false; reason: string }> {
  const userId = await findUserByChat(handle, input.chatId);
  if (!userId) return { ok: false, reason: "This chat is not connected to an Aeyhey account." };

  const { cards } = handle.schema;
  const { sql } = await import("drizzle-orm");

  const rows = await handle.db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.userId, userId),
        // Suffix match on the shortened id, scoped to this user's cards.
        sql`substr(${cards.id}, -10) = ${input.shortCardId}`,
      ),
    )
    .limit(2);

  if (rows.length === 0) return { ok: false, reason: "That card is no longer there." };
  if (rows.length > 1) {
    // Two of this user's ULIDs ending the same way is close to impossible, but acting on
    // the wrong card would be worse than asking them to use the app.
    return { ok: false, reason: "Could not tell which card that was. Open the app instead." };
  }

  return { ok: true, userId, cardId: rows[0]!.id };
}

/** Maps a reply back to the question it answers (PRD 10 telegram_messages). */
export async function recordSentMessage(
  handle: DbHandle,
  input: { userId: string; chatId: string; messageId: number; cardId?: string; sessionId?: string },
): Promise<void> {
  const { telegramMessages } = handle.schema;
  await handle.db
    .insert(telegramMessages)
    .values({
      id: newId(),
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.messageId,
      cardId: input.cardId ?? null,
      sessionId: input.sessionId ?? null,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function findCardForReply(
  handle: DbHandle,
  input: { chatId: string; replyToMessageId: number },
): Promise<{ userId: string; cardId: string } | null> {
  const { telegramMessages } = handle.schema;
  const rows = await handle.db
    .select()
    .from(telegramMessages)
    .where(
      and(
        eq(telegramMessages.chatId, input.chatId),
        eq(telegramMessages.messageId, input.replyToMessageId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row?.cardId ? { userId: row.userId, cardId: row.cardId } : null;
}

// ---------------------------------------------------------------- saving a link by message

/** Any URL sent to the bot gets saved (PRD 12.2). */
export async function saveLinkFromMessage(
  handle: DbHandle,
  input: { userId: string; text: string },
): Promise<{ saved: number; duplicates: number }> {
  const found = extractUrls(input.text);
  if (found.urls.length === 0) return { saved: 0, duplicates: 0 };

  const scope = scopeFor(handle, input.userId);
  const result = await saveLinks(scope, { text: input.text, source: "telegram" });

  for (const link of result.created) {
    await enqueue(handle, {
      type: "extract_link",
      userId: input.userId,
      payload: { linkId: link.id },
      dedupeKey: `extract:${link.id}`,
    });
  }

  return { saved: result.created.length, duplicates: result.duplicates.length };
}

// ---------------------------------------------------------------- the channel

export interface TelegramApi {
  sendMessage(input: {
    chatId: string;
    text: string;
    buttons?: { text: string; callback_data: string }[][];
    parseMode?: "HTML";
    disablePreview?: boolean;
  }): Promise<{ messageId: number }>;
  editMessage(input: {
    chatId: string;
    messageId: number;
    text: string;
    parseMode?: "HTML";
    buttons?: { text: string; callback_data: string }[][];
  }): Promise<void>;
  answerCallback(input: { callbackId: string; text?: string }): Promise<void>;
  getMe(): Promise<{ username: string }>;
}

/** The live API, through grammY. Swapped for a fake in tests. */
export function createTelegramApi(botToken: string): TelegramApi {
  // grammY is loaded lazily, so an instance with no bot token never pulls it in.
  let apiPromise: Promise<GrammyApi> | null = null;

  const api = async (): Promise<GrammyApi> => {
    if (!apiPromise) {
      apiPromise = import("grammy").then(({ Api }) => new Api(botToken));
    }
    return apiPromise;
  };

  return {
    async sendMessage(input) {
      const client = await api();
      const message = await client.sendMessage(input.chatId, input.text, {
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
        ...(input.disablePreview ? { link_preview_options: { is_disabled: true } } : {}),
        ...(input.buttons ? { reply_markup: { inline_keyboard: input.buttons } } : {}),
      });
      return { messageId: message.message_id };
    },

    async editMessage(input) {
      const client = await api();
      await client.editMessageText(input.chatId, input.messageId, input.text, {
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
        // Passing no keyboard removes the buttons, which is what we want after an action.
        reply_markup: input.buttons ? { inline_keyboard: input.buttons } : { inline_keyboard: [] },
      });
    },

    async answerCallback(input) {
      const client = await api();
      await client.answerCallbackQuery(input.callbackId, {
        ...(input.text ? { text: input.text } : {}),
      });
    },

    async getMe() {
      const client = await api();
      const me = await client.getMe();
      return { username: me.username };
    },
  };
}

export interface TelegramChannelOptions extends TelegramOptions {
  api?: TelegramApi;
}

export function createTelegramChannel(options: TelegramChannelOptions): NotificationChannel {
  const { handle } = options;
  const api = options.api ?? (options.botToken ? createTelegramApi(options.botToken) : null);

  async function sendCard(
    chatId: string,
    userId: string,
    sessionId: string,
    cardId: string,
    message: TelegramMessage,
  ): Promise<void> {
    if (!api) return;
    const sent = await api.sendMessage({
      chatId,
      text: message.text,
      buttons: message.buttons,
      parseMode: message.parseMode,
      disablePreview: message.disablePreview,
    });
    // Recorded so a reply to this message can be matched back to the card.
    await recordSentMessage(handle, {
      userId,
      chatId,
      messageId: sent.messageId,
      cardId,
      sessionId,
    });
  }

  return {
    id: "telegram",

    isConfigured() {
      return Boolean(options.botToken && api);
    },

    async isEnabledFor(userId) {
      return (await findChatForUser(handle, userId)) !== null;
    },

    async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
      if (!api) return { ok: false, error: "No Telegram bot token is configured." };

      const chatId = await findChatForUser(handle, payload.userId);
      if (!chatId) return { ok: false, error: "This account has no Telegram chat connected." };

      try {
        // A header, then one message per card. Each card is independent, which is the
        // whole design of this channel.
        await api.sendMessage({
          chatId,
          text: renderSessionHeader(
            payload.items.length,
            payload.nextSessionLabel,
            newQuestionsLine(payload.items),
          ),
          parseMode: "HTML",
        });

        for (const item of payload.items) {
          const message = item.kind === "link" ? renderLinkCard(item) : renderQuestionCard(item);
          await sendCard(chatId, payload.userId, payload.sessionId, item.cardId, message);
        }

        return { ok: true, messagesSent: payload.items.length + 1 };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },

    async sendTest(userId) {
      if (!api) return { ok: false, error: "No Telegram bot token is configured." };

      const chatId = await findChatForUser(handle, userId);
      if (!chatId) return { ok: false, error: "Connect Telegram first, then try the test again." };

      try {
        await api.sendMessage({
          chatId,
          text: "<b>Aeyhey is connected.</b>\nYour cards will arrive here, one message each.",
          parseMode: "HTML",
        });
        return { ok: true, messagesSent: 1 };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  };
}

export { decodeCallback };
export * from "./format";
