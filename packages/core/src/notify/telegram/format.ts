// SPDX-License-Identifier: AGPL-3.0-only
// Telegram message formatting and callback data (PRD 12.2, 14.3).
//
// The whole point of this channel: one message per card, each with its own buttons, so the
// user can handle them in any order. That is the fix over a bot that sends five questions
// in one message and expects all five answers in one reply.
//
// Callback data is capped at 64 bytes by Telegram, so card ids are shortened on the way
// out and matched by suffix on the way back.

import type { CardView } from "../../sessions/views";

export type TelegramAction =
  "read" | "later" | "drop" | "reveal" | "skip" | "easy" | "hard" | "rate";

export interface CallbackData {
  action: TelegramAction;
  /** The last 10 characters of the card id. ULIDs make a collision vanishingly unlikely. */
  shortCardId: string;
  rating?: number;
}

const CALLBACK_PREFIX = "a";

/** "a:1ABCDEFGHJ:later" or "a:1ABCDEFGHJ:rate:3". Always under 64 bytes. */
export function encodeCallback(data: CallbackData): string {
  const parts = [CALLBACK_PREFIX, data.shortCardId, data.action];
  if (data.rating !== undefined) parts.push(String(data.rating));
  const encoded = parts.join(":");

  if (Buffer.byteLength(encoded, "utf8") > 64) {
    throw new Error(`Callback data is too long for Telegram: ${encoded}`);
  }
  return encoded;
}

export function decodeCallback(raw: string): CallbackData | null {
  const parts = raw.split(":");
  if (parts.length < 3 || parts[0] !== CALLBACK_PREFIX) return null;

  const [, shortCardId, action, rating] = parts;
  if (!shortCardId || !action) return null;

  const known: TelegramAction[] = [
    "read",
    "later",
    "drop",
    "reveal",
    "skip",
    "easy",
    "hard",
    "rate",
  ];
  if (!known.includes(action as TelegramAction)) return null;

  return {
    action: action as TelegramAction,
    shortCardId,
    ...(rating !== undefined ? { rating: Number(rating) } : {}),
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface TelegramMessage {
  text: string;
  /** Telegram's inline keyboard shape. */
  buttons: { text: string; callback_data: string }[][];
  parseMode: "HTML";
  /** A link preview would push the buttons off screen on a phone. */
  disablePreview: boolean;
}

export function renderLinkCard(item: CardView & { kind: "link" }): TelegramMessage {
  const short = item.cardId.slice(-10);
  const lines: string[] = [];

  if (item.lastChance) lines.push("<b>Last chance</b>");
  lines.push(`<b>${escapeHtml(item.title)}</b>`);

  const meta = [item.siteName, item.readMinutes ? `${item.readMinutes} min read` : null]
    .filter(Boolean)
    .join(" · ");
  if (meta) lines.push(`<i>${escapeHtml(meta)}</i>`);

  lines.push("");
  for (const line of item.summaryLines ?? []) lines.push(escapeHtml(line));
  if (item.whySaved) {
    lines.push("");
    lines.push(`<i>${escapeHtml(item.whySaved)}</i>`);
  }
  lines.push("");
  lines.push(escapeHtml(item.url));

  return {
    text: lines.join("\n"),
    buttons: [
      [
        { text: "Read now", callback_data: encodeCallback({ action: "read", shortCardId: short }) },
        { text: "Later", callback_data: encodeCallback({ action: "later", shortCardId: short }) },
        { text: "Drop", callback_data: encodeCallback({ action: "drop", shortCardId: short }) },
      ],
    ],
    parseMode: "HTML",
    disablePreview: true,
  };
}

export function renderQuestionCard(item: CardView & { kind: "question" }): TelegramMessage {
  const short = item.cardId.slice(-10);

  return {
    text: [
      `<i>${escapeHtml(item.sourceLabel)} · ${item.difficulty}</i>`,
      "",
      `<b>${escapeHtml(item.text)}</b>`,
      "",
      "<i>Reply to this message with your answer, and I will grade it.</i>",
    ].join("\n"),
    buttons: [
      [
        { text: "Reveal", callback_data: encodeCallback({ action: "reveal", shortCardId: short }) },
        { text: "Skip", callback_data: encodeCallback({ action: "skip", shortCardId: short }) },
      ],
      [
        { text: "Easy", callback_data: encodeCallback({ action: "easy", shortCardId: short }) },
        { text: "Hard", callback_data: encodeCallback({ action: "hard", shortCardId: short }) },
      ],
    ],
    parseMode: "HTML",
    disablePreview: true,
  };
}

/** After a reveal or a grade: the answer, then the four rating buttons. */
export function renderAnswerWithRatings(input: {
  cardId: string;
  questionText: string;
  modelAnswer: string;
  grade?: { score: number; feedback: string; missed: string[] } | null;
  suggestedRating: number;
}): TelegramMessage {
  const short = input.cardId.slice(-10);
  const lines: string[] = [`<b>${escapeHtml(input.questionText)}</b>`, ""];

  if (input.grade) {
    lines.push(`<b>Score: ${input.grade.score}/100</b>`);
    lines.push(escapeHtml(input.grade.feedback));
    if (input.grade.missed.length > 0) {
      lines.push("");
      lines.push("<b>What you missed</b>");
      for (const point of input.grade.missed) lines.push(`• ${escapeHtml(point)}`);
    }
    lines.push("");
  }

  lines.push("<b>Model answer</b>");
  lines.push(escapeHtml(input.modelAnswer));
  lines.push("");
  lines.push("<i>How did you do?</i>");

  // The suggested rating is marked, so the obvious tap is the right one.
  const label = (text: string, rating: number): string =>
    rating === input.suggestedRating ? `✓ ${text}` : text;

  return {
    text: lines.join("\n"),
    buttons: [
      [
        {
          text: label("Again", 1),
          callback_data: encodeCallback({ action: "rate", shortCardId: short, rating: 1 }),
        },
        {
          text: label("Hard", 2),
          callback_data: encodeCallback({ action: "rate", shortCardId: short, rating: 2 }),
        },
        {
          text: label("Good", 3),
          callback_data: encodeCallback({ action: "rate", shortCardId: short, rating: 3 }),
        },
        {
          text: label("Easy", 4),
          callback_data: encodeCallback({ action: "rate", shortCardId: short, rating: 4 }),
        },
      ],
    ],
    parseMode: "HTML",
    disablePreview: true,
  };
}

export function renderSessionHeader(
  count: number,
  nextSessionLabel: string,
  newQuestions: string | null = null,
): string {
  return [
    `<b>${count} card${count === 1 ? "" : "s"} for today</b>${newQuestions ? `, ${escapeHtml(newQuestions)}` : ""}`,
    `<i>Next session: ${nextSessionLabel}</i>`,
  ].join("\n");
}

/** The result line a message is edited to after an action, replacing the buttons. */
export function renderActionResult(action: TelegramAction, nextDueLabel: string): string {
  switch (action) {
    case "read":
      return `<b>Opened.</b> ${escapeHtml(nextDueLabel)}`;
    case "later":
      return `<b>Snoozed.</b> ${escapeHtml(nextDueLabel)}`;
    case "drop":
      return "<b>Dropped.</b> You can restore it from the inbox.";
    case "skip":
      return "<b>Skipped.</b> Back in your next session.";
    default:
      return `<b>Done.</b> ${escapeHtml(nextDueLabel)}`;
  }
}

/**
 * What "/pause" asks for. "/pause" alone is a week, "/pause 3" is three days (1 to 90),
 * and "/pause forever" (or "off", "indefinitely") lasts until "/resume". Null when the
 * argument makes no sense, so the bot can say how to use it instead of guessing.
 */
export function parsePauseCommand(text: string): { forever: true } | { days: number } | null {
  const arg = text
    .trim()
    .replace(/^\/pause(@\w+)?/i, "")
    .trim()
    .toLowerCase();
  if (arg === "") return { days: 7 };
  if (["forever", "off", "indefinitely", "indefinite"].includes(arg)) return { forever: true };
  const days = Number(arg.replace(/\s*days?$/, ""));
  if (Number.isInteger(days) && days >= 1 && days <= 90) return { days };
  return null;
}

/** The bot's reply once paused. */
export function pauseReply(pause: { forever: true } | { until: Date }): string {
  return "forever" in pause
    ? "Paused until you send /resume. No reminders and no new questions until then."
    : `Paused until ${pause.until.toDateString()}. Send /resume to start again.`;
}

export const PAUSE_USAGE =
  "Send /pause for a week, /pause 3 for three days (up to 90), or /pause forever to stop until you send /resume.";
