// SPDX-License-Identifier: AGPL-3.0-only
// Handling one Telegram update (PRD 12.2, 14.3).
//
// This is where the design that fixes the Career Coach bot lives. Every card is its own
// message with its own buttons, so a callback carries the card it belongs to and nothing
// has to be answered in order.
//
// Ownership is checked on every update, never assumed from a previous one.

import type { DbHandle } from "@aeyhey/core/db";
import type { Env } from "@aeyhey/core";
import type { Registry } from "@aeyhey/core/extensions";
import { assistant, jobs, notify, repos } from "@aeyhey/core";
import { security } from "@aeyhey/core";
import { ai as aiModule } from "@aeyhey/core";
import { applyCardAction } from "@aeyhey/core/sessions";
import { answerQuestion, revealAnswer } from "@aeyhey/core/sessions";

export interface TelegramDeps {
  handle: DbHandle;
  env: Env;
  appSecret: string;
  registry: Registry;
}

interface Update {
  message?: {
    message_id: number;
    chat: { id: number | string };
    from?: { username?: string };
    text?: string;
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number | string } };
  };
}

function aiDeps(deps: TelegramDeps) {
  return {
    keys: deps.registry.aiKeys,
    gate: deps.registry.usageGate,
    sink: deps.registry.usageSink,
    limiter: new aiModule.AiLimiter({
      maxConcurrency: deps.env.AI_MAX_CONCURRENCY,
      requestsPerMinute: deps.env.AI_RPM,
    }),
  };
}

const TELEGRAM_TEXT_LIMIT = 4096;

export function telegramLoginUrl(input: {
  publicUrl: string;
  appSecret: string;
  chatId: string;
  username?: string;
}): string {
  const signed = security.signToken({
    purpose: "telegram-login",
    payload: {
      chatId: input.chatId,
      ...(input.username ? { username: input.username } : {}),
    },
    appSecret: input.appSecret,
    ttlMs: security.TEN_MINUTES_MS,
  });
  return `${input.publicUrl}/telegram/connect?token=${encodeURIComponent(signed.token)}`;
}

function wantsDeckNow(text: string): boolean {
  return /\b(make|create|build|generate|write)\b[\s\S]{0,80}\b(deck|questions?|quiz)\b|\b(deck|questions?|quiz)\b[\s\S]{0,80}\b(make|create|build|generate|write)\b/i.test(
    text,
  );
}

export function renderAssistantReply(reply: assistant.AssistantReply): string {
  const lines = [reply.reply.trim()];

  if (reply.answer?.sources.length) {
    lines.push("", "Sources");
    for (const source of reply.answer.sources.slice(0, 5)) {
      lines.push(`${source.title}\n${source.href}`);
    }
  }

  if (reply.blocked?.actionHref) {
    lines.push("", `Continue here: ${reply.blocked.actionHref}`);
  }

  if (reply.options?.length) {
    lines.push("", "You can say:");
    for (const option of reply.options) lines.push(`• ${option.label}`);
  }

  const text = lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  return `${text.slice(0, TELEGRAM_TEXT_LIMIT - 1).trimEnd()}…`;
}

async function answerAsAey(
  deps: TelegramDeps,
  api: notify.TelegramApi,
  chatId: string,
  userId: string,
  text: string,
): Promise<void> {
  const scope = repos.scopeFor(deps.handle, userId);
  const reply = await assistant.respond(
    scope,
    {
      ai: aiDeps(deps),
      saveLinks: async (message) => {
        const result = await repos.saveLinks(scope, {
          text: message,
          note: null,
          source: "telegram",
        });
        for (const link of result.created) {
          await jobs.enqueue(deps.handle, {
            type: "extract_link",
            userId,
            payload: { linkId: link.id },
            dedupeKey: `extract:${link.id}`,
          });
        }
        return result;
      },
    },
    { message: text },
  );

  let response = renderAssistantReply(reply);
  if (reply.proposal) {
    if (wantsDeckNow(text)) {
      const sourceId = await repos.createTopicSource(scope, {
        topics: reply.proposal.topics,
        level: reply.proposal.level,
        style: reply.proposal.style,
        countPerTopic: reply.proposal.countPerTopic,
      });
      await jobs.enqueue(deps.handle, {
        type: "generate_questions",
        userId,
        payload: { sourceId },
        dedupeKey: `generate:${sourceId}`,
      });
      response = `${response}\n\nI am writing the questions now. They will appear in AeyHey when they are ready.`;
    } else {
      const topics = reply.proposal.topics.join(", ");
      response = `${response}\n\nIf you want it, say “Create a deck about ${topics}.”`;
    }
  }

  await api.sendMessage({ chatId, text: response.slice(0, TELEGRAM_TEXT_LIMIT) });
}

export async function handleTelegramUpdate(deps: TelegramDeps, raw: unknown): Promise<void> {
  const update = raw as Update;
  const api = notify.createTelegramApi(deps.env.TELEGRAM_BOT_TOKEN!);

  if (update.callback_query) {
    await handleCallback(deps, api, update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(deps, api, update.message);
  }
}

async function handleCallback(
  deps: TelegramDeps,
  api: notify.TelegramApi,
  query: NonNullable<Update["callback_query"]>,
): Promise<void> {
  const chatId = String(query.message?.chat.id ?? "");
  const decoded = query.data ? notify.decodeCallback(query.data) : null;

  if (!decoded || !chatId) {
    await api.answerCallback({ callbackId: query.id, text: "That button is no longer valid." });
    return;
  }

  // The ownership check. A chat id is guessable, so this runs on every callback.
  const resolved = await notify.resolveCallbackCard(deps.handle, {
    chatId,
    shortCardId: decoded.shortCardId,
  });
  if (!resolved.ok) {
    await api.answerCallback({ callbackId: query.id, text: resolved.reason });
    return;
  }

  const scope = repos.scopeFor(deps.handle, resolved.userId);
  const messageId = query.message!.message_id;

  try {
    if (decoded.action === "reveal") {
      const revealed = await revealAnswer(scope, resolved.cardId);
      const question = await repos.findCardById(scope, resolved.cardId);
      const row = question ? await repos.findQuestion(scope, question.itemId) : null;

      const message = notify.renderAnswerWithRatings({
        cardId: resolved.cardId,
        questionText: row?.text ?? "",
        modelAnswer: revealed.modelAnswer,
        grade: null,
        suggestedRating: revealed.suggestedRating,
      });

      await api.editMessage({
        chatId,
        messageId,
        text: message.text,
        parseMode: "HTML",
        buttons: message.buttons,
      });
      await api.answerCallback({ callbackId: query.id });
      return;
    }

    const action =
      decoded.action === "read"
        ? ({ action: "read" } as const)
        : decoded.action === "later"
          ? ({ action: "snooze", variant: "default" } as const)
          : decoded.action === "drop"
            ? ({ action: "drop" } as const)
            : decoded.action === "skip"
              ? ({ action: "skip" } as const)
              : decoded.action === "easy"
                ? ({ action: "rate", rating: 4, via: "quick" } as const)
                : decoded.action === "hard"
                  ? ({ action: "rate", rating: 2, via: "quick" } as const)
                  : ({
                      action: "rate",
                      rating: (decoded.rating ?? 3) as 1 | 2 | 3 | 4,
                      via: "reveal",
                    } as const);

    const result = await applyCardAction({ scope, channel: "telegram" }, resolved.cardId, action);

    // The message is edited to show the outcome and the buttons are removed, so a second
    // tap cannot do anything. Actions are idempotent anyway, but this makes it visible.
    await api.editMessage({
      chatId,
      messageId,
      text: notify.renderActionResult(decoded.action, result.nextDueLabel),
      parseMode: "HTML",
    });

    await api.answerCallback({
      callbackId: query.id,
      ...(decoded.action === "read" && result.openUrl ? { text: result.openUrl } : {}),
    });

    // Read now replies with the URL, because a Telegram message cannot open a tab.
    if (decoded.action === "read" && result.openUrl) {
      await api.sendMessage({ chatId, text: result.openUrl });
    }
  } catch (error) {
    await api.answerCallback({
      callbackId: query.id,
      text: (error as Error).message.slice(0, 180),
    });
  }
}

async function handleMessage(
  deps: TelegramDeps,
  api: notify.TelegramApi,
  message: NonNullable<Update["message"]>,
): Promise<void> {
  const chatId = String(message.chat.id);
  const text = (message.text ?? "").trim();
  if (text === "") return;

  async function sendLoginLink(): Promise<void> {
    const existing = await notify.findUserByChat(deps.handle, chatId);
    if (existing) {
      await api.sendMessage({
        chatId,
        text: "<b>Connected.</b> This chat is already linked to your Aeyhey account.",
        parseMode: "HTML",
        buttons: [
          [{ text: "Manage connection", url: `${deps.env.PUBLIC_URL}/settings/notifications` }],
        ],
      });
      return;
    }

    const url = telegramLoginUrl({
      publicUrl: deps.env.PUBLIC_URL,
      appSecret: deps.appSecret,
      chatId,
      ...(message.from?.username ? { username: message.from.username } : {}),
    });
    await api.sendMessage({
      chatId,
      text: "Connect this chat to your Aeyhey account. You may be asked to sign in, then you can approve the connection.",
      buttons: [[{ text: "Connect to Aeyhey", url }]],
    });
  }

  // /start <code> keeps old links working. A plain /start uses the smoother web approval.
  if (text.startsWith("/start")) {
    const code = text.slice("/start".length).trim();
    if (!code) {
      await sendLoginLink();
      return;
    }

    const result = await notify.redeemLinkCode(deps.handle, {
      chatId,
      code,
      ...(message.from?.username ? { username: message.from.username } : {}),
    });

    await api.sendMessage({
      chatId,
      text: result.ok
        ? "<b>Connected.</b> Your cards will arrive here, one message each."
        : (result.reason ?? "That code did not work."),
      parseMode: "HTML",
    });
    return;
  }

  if (text.startsWith("/login")) {
    await sendLoginLink();
    return;
  }

  const userId = await notify.findUserByChat(deps.handle, chatId);
  if (!userId) {
    await sendLoginLink();
    return;
  }

  const scope = repos.scopeFor(deps.handle, userId);

  // A reply to a question message is an answer to that question (PRD 12.2).
  if (message.reply_to_message) {
    const target = await notify.findCardForReply(deps.handle, {
      chatId,
      replyToMessageId: message.reply_to_message.message_id,
    });

    if (target) {
      const card = await repos.findCardById(scope, target.cardId);
      if (card?.itemType === "question") {
        const row = await repos.findQuestion(scope, card.itemId);
        const graded = await answerQuestion(
          { scope, ai: aiDeps(deps), channel: "telegram" },
          target.cardId,
          text,
        );

        const reply = notify.renderAnswerWithRatings({
          cardId: target.cardId,
          questionText: row?.text ?? "",
          modelAnswer: graded.modelAnswer,
          grade: graded.grade
            ? {
                score: graded.grade.score,
                feedback: graded.grade.feedback,
                missed: graded.grade.missed_points,
              }
            : null,
          suggestedRating: graded.suggestedRating,
        });

        await api.sendMessage({
          chatId,
          text: reply.text,
          buttons: reply.buttons,
          parseMode: "HTML",
          disablePreview: true,
        });
        return;
      }
    }
  }

  // Commands (PRD 12.2).
  if (text.startsWith("/today")) {
    const { getOrBuildSession } = await import("@aeyhey/core/sessions");
    const payload = await getOrBuildSession(scope, { trigger: "telegram" });

    if (!payload.session || payload.items.length === 0) {
      await api.sendMessage({
        chatId,
        text: `Nothing due. Next session: ${payload.nextSessionLabel}`,
      });
      return;
    }

    const built = await notify.buildChannels({
      handle: deps.handle,
      env: deps.env,
      appSecret: deps.appSecret,
    });
    await built.byId.get("telegram")?.deliver({
      userId,
      sessionId: payload.session.id,
      items: payload.items,
      nextSessionLabel: payload.nextSessionLabel,
      publicUrl: deps.env.PUBLIC_URL,
      expiredSinceLast: 0,
    });
    return;
  }

  if (text.startsWith("/pause")) {
    const pause = notify.parsePauseCommand(text);
    if (!pause) {
      await api.sendMessage({ chatId, text: notify.PAUSE_USAGE });
      return;
    }
    if ("forever" in pause) {
      await repos.pauseIndefinitely(scope);
      await api.sendMessage({ chatId, text: notify.pauseReply({ forever: true }) });
      return;
    }
    const until = await repos.pauseFor(scope, pause.days);
    await api.sendMessage({ chatId, text: notify.pauseReply({ until }) });
    return;
  }

  if (text.startsWith("/resume")) {
    await repos.resumeNow(scope);
    await api.sendMessage({ chatId, text: "Reminders are back on." });
    return;
  }

  if (text.startsWith("/settings")) {
    await api.sendMessage({ chatId, text: `${deps.env.PUBLIC_URL}/settings` });
    return;
  }

  if (text.startsWith("/add")) {
    const payload = text.slice("/add".length).trim();
    await answerAsAey(deps, api, chatId, userId, payload);
    return;
  }

  if (text.startsWith("/")) {
    await api.sendMessage({
      chatId,
      text: "You can talk to me normally. I can answer from your library, save what you send, create practice decks and help with Aeyhey. Shortcuts: /today, /pause, /resume, /settings.",
    });
    return;
  }

  await answerAsAey(deps, api, chatId, userId, text);
}
