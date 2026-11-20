// SPDX-License-Identifier: AGPL-3.0-only
// What every notification channel implements (PRD 14).
//
// A channel is deliberately dumb: it is handed a built session and asked to deliver it.
// Deciding whether to send, and building the session, happens once in the reminder loop,
// so the three channels cannot disagree about what is due.

import type { Channel } from "../db/types";
import type { CardView } from "../sessions/views";

export interface DeliveryPayload {
  userId: string;
  sessionId: string;
  items: CardView[];
  /** "Tuesday at 09:00". */
  nextSessionLabel: string;
  /** Absolute, because a link in a notification has to work from anywhere. */
  publicUrl: string;
  /** Mentioned in the session summary line when any expired (PRD 9.4 rule 5). */
  expiredSinceLast: number;
}

export interface DeliveryResult {
  ok: boolean;
  /** Plain words, stored on the notification row when it failed. */
  error?: string;
  /** How many messages went out. Telegram sends one per card. */
  messagesSent?: number;
}

export interface NotificationChannel {
  readonly id: Channel;
  /** False when the channel is not configured, so the loop can skip it silently. */
  isConfigured(): boolean;
  /** Whether this user has this channel turned on and verified. */
  isEnabledFor(userId: string): Promise<boolean>;
  deliver(payload: DeliveryPayload): Promise<DeliveryResult>;
  /** The Test button in Settings (PRD 8.4 FR-SET-3). */
  sendTest(userId: string): Promise<DeliveryResult>;
}

/**
 * The part of the reminder that says new questions were written for it, such as "3 of
 * them new questions on Physics". Null when the session holds no new questions. Shared by
 * every channel, so they all say it the same way.
 */
export function newQuestionsLine(items: CardView[]): string | null {
  const fresh = items.filter((item) => item.kind === "question" && item.isNew);
  if (fresh.length === 0) return null;

  const topics = [
    ...new Set(fresh.map((item) => (item.kind === "question" ? item.sourceLabel : ""))),
  ].filter(Boolean);
  // A label like "From your resume" already reads as a phrase; a topic name needs "on".
  const about = (label: string) =>
    label.startsWith("From ") ? `from ${label.slice(5)}` : `on ${label}`;
  const on =
    topics.length === 1
      ? ` ${about(topics[0]!)}`
      : topics.length === 2 && topics.every((label) => !label.startsWith("From "))
        ? ` on ${topics[0]} and ${topics[1]}`
        : "";

  const n = fresh.length;
  if (items.length === 1) return `a new question${on}`;
  if (n === items.length) return `${n === 2 ? "both" : "all"} new questions${on}`;
  if (n === 1) return `one of them a new question${on}`;
  return `${n} of them new questions${on}`;
}

function sentence(text: string): string {
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** Shared copy, so push and Telegram say the same thing (PRD 12.2). */
export function summarizeForNotification(items: CardView[]): {
  title: string;
  body: string;
} {
  const links = items.filter((item) => item.kind === "link").length;
  const questions = items.length - links;

  const title = items.length === 1 ? "1 card ready" : `${items.length} cards ready`;

  const parts: string[] = [];
  const firstLink = items.find((item) => item.kind === "link");
  const firstQuestion = items.find((item) => item.kind === "question");

  if (firstLink && firstLink.kind === "link") parts.push(firstLink.title);
  if (firstQuestion && firstQuestion.kind === "question") parts.push(firstQuestion.text);

  // New questions written for this reminder lead the body: that is the news in it.
  const fresh = newQuestionsLine(items);
  const body = fresh
    ? sentence(fresh).slice(0, 160)
    : parts.length > 0
      ? parts.join(" and ").slice(0, 160)
      : `${links} links and ${questions} questions.`;

  return { title, body };
}
