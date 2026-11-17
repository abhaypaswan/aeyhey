// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  decodeCallback,
  encodeCallback,
  parsePauseCommand,
  pauseReply,
  renderActionResult,
  renderAnswerWithRatings,
  renderLinkCard,
  renderQuestionCard,
  renderSessionHeader,
} from "../../src/notify/telegram/format";
import { resolveTelegramMode } from "../../src/notify/telegram/index";
import {
  renderSessionEmailHtml,
  renderSessionEmailText,
  renderVerifyEmail,
} from "../../src/notify/email/templates";
import { summarizeForNotification } from "../../src/notify/types";
import type { CardView } from "../../src/sessions/views";

const linkCard: CardView = {
  kind: "link",
  cardId: "01JABCDEFGHJKMNPQRSTVWXYZ",
  linkId: "l1",
  title: "Choosing a Postgres index",
  url: "https://example.com/postgres-index",
  siteName: "Example Blog",
  summaryLines: ["A b-tree is the default.", "GIN suits containment.", "Measure first."],
  whySaved: "You probably saved this for the migration.",
  tags: ["postgres"],
  readMinutes: 6,
  savedAt: "2026-06-01T00:00:00.000Z",
  status: "unread",
  lastChance: false,
};

const questionCard: CardView = {
  kind: "question",
  cardId: "01JQQQQQQQQQQQQQQQQQQQQQQQ",
  questionId: "q1",
  text: "How do you make a payment endpoint idempotent?",
  tags: ["apis"],
  difficulty: "medium",
  category: "technical",
  sourceLabel: "From your resume",
  isNew: true,
};

describe("telegram callback data", () => {
  it("round trips an action", () => {
    const encoded = encodeCallback({ action: "later", shortCardId: "ABCDEFGHJK" });
    expect(decodeCallback(encoded)).toEqual({ action: "later", shortCardId: "ABCDEFGHJK" });
  });

  it("round trips a rating", () => {
    const encoded = encodeCallback({ action: "rate", shortCardId: "ABCDEFGHJK", rating: 3 });
    expect(decodeCallback(encoded)).toEqual({
      action: "rate",
      shortCardId: "ABCDEFGHJK",
      rating: 3,
    });
  });

  it("stays inside Telegram's 64 byte limit", () => {
    for (const action of ["read", "later", "drop", "reveal", "skip", "easy", "hard"] as const) {
      const encoded = encodeCallback({ action, shortCardId: "ABCDEFGHJK" });
      expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(64);
    }
    const withRating = encodeCallback({ action: "rate", shortCardId: "ABCDEFGHJK", rating: 4 });
    expect(Buffer.byteLength(withRating, "utf8")).toBeLessThanOrEqual(64);
  });

  it("refuses data it did not produce", () => {
    expect(decodeCallback("")).toBeNull();
    expect(decodeCallback("nonsense")).toBeNull();
    expect(decodeCallback("x:ABCDEFGHJK:read")).toBeNull();
    expect(decodeCallback("a:ABCDEFGHJK:delete_everything")).toBeNull();
    expect(decodeCallback("a:ABCDEFGHJK")).toBeNull();
  });
});

describe("telegram card messages", () => {
  it("gives a link card its own three buttons", () => {
    const message = renderLinkCard(linkCard as CardView & { kind: "link" });

    expect(message.text).toContain("Choosing a Postgres index");
    expect(message.text).toContain("A b-tree is the default.");
    expect(message.text).toContain("https://example.com/postgres-index");

    const labels = message.buttons.flat().map((button) => button.text);
    expect(labels).toEqual(["Read now", "Later", "Drop"]);
    // Every button carries this card's own id, which is what makes the messages
    // independent of each other.
    for (const button of message.buttons.flat()) {
      expect(decodeCallback(button.callback_data)!.shortCardId).toBe(linkCard.cardId.slice(-10));
    }
  });

  it("marks a last chance link", () => {
    const message = renderLinkCard({ ...linkCard, lastChance: true } as CardView & {
      kind: "link";
    });
    expect(message.text).toContain("Last chance");
  });

  it("gives a question card reveal, skip and the two quick ratings", () => {
    const message = renderQuestionCard(questionCard as CardView & { kind: "question" });
    const labels = message.buttons.flat().map((button) => button.text);
    expect(labels).toEqual(["Reveal", "Skip", "Easy", "Hard"]);
    // The reply hint is what makes answering in Telegram discoverable.
    expect(message.text).toMatch(/reply to this message/i);
  });

  it("escapes HTML so a page title cannot break the message", () => {
    const message = renderLinkCard({
      ...linkCard,
      title: '<script>alert("x")</script> & more',
    } as CardView & { kind: "link" });
    expect(message.text).not.toContain("<script>");
    expect(message.text).toContain("&lt;script&gt;");
    expect(message.text).toContain("&amp; more");
  });

  it("marks the suggested rating so the obvious tap is the right one", () => {
    const message = renderAnswerWithRatings({
      cardId: questionCard.cardId,
      questionText: "A question",
      modelAnswer: "The answer.",
      grade: { score: 72, feedback: "Solid.", missed: ["one thing"] },
      suggestedRating: 3,
    });

    const good = message.buttons.flat().find((button) => button.text.includes("Good"));
    expect(good!.text.startsWith("✓")).toBe(true);
    expect(message.text).toContain("Score: 72/100");
    expect(message.text).toContain("one thing");
  });

  it("shows the answer with no grade for a plain reveal", () => {
    const message = renderAnswerWithRatings({
      cardId: questionCard.cardId,
      questionText: "A question",
      modelAnswer: "The answer.",
      grade: null,
      suggestedRating: 2,
    });
    expect(message.text).not.toContain("Score:");
    expect(message.text).toContain("Model answer");
    expect(message.buttons.flat()).toHaveLength(4);
  });

  it("writes a header and a result line in plain words", () => {
    expect(renderSessionHeader(5, "Tuesday at 09:00")).toContain("5 cards for today");
    expect(renderSessionHeader(1, "Tomorrow at 09:00")).toContain("1 card for today");
    expect(renderActionResult("later", "Back in about 2 weeks")).toContain("Back in about 2 weeks");
    expect(renderActionResult("drop", "")).toMatch(/restore it from the inbox/i);
  });
});

describe("telegram transport choice", () => {
  it("uses a webhook only when there is an https URL to receive on", () => {
    expect(resolveTelegramMode({ mode: "auto", publicUrl: "https://aeyhey.example.com" })).toBe(
      "webhook",
    );
    // A home server with no public URL still works, through polling.
    expect(resolveTelegramMode({ mode: "auto", publicUrl: "http://localhost:3000" })).toBe(
      "polling",
    );
    expect(resolveTelegramMode({ mode: "webhook", publicUrl: "http://localhost:3000" })).toBe(
      "webhook",
    );
  });
});

describe("email templates", () => {
  const input = {
    displayName: "Jane",
    items: [linkCard, questionCard],
    publicUrl: "https://aeyhey.example.com",
    nextSessionLabel: "Tuesday at 09:00",
    tokens: {
      read: { [linkCard.cardId]: "read-token" },
      later: { [linkCard.cardId]: "later-token" },
      drop: { [linkCard.cardId]: "drop-token" },
    },
    unsubscribeToken: "unsub-token",
    pauseToken: "pause-token",
    expiredSinceLast: 3,
  };

  it("gives link cards one-tap actions that work without the app", () => {
    const html = renderSessionEmailHtml(input);
    expect(html).toContain("https://aeyhey.example.com/e/read-token");
    expect(html).toContain("https://aeyhey.example.com/e/later-token");
    expect(html).toContain("https://aeyhey.example.com/e/drop-token");
  });

  it("sends a question card into the app, because answering needs a text box", () => {
    const html = renderSessionEmailHtml(input);
    expect(html).toContain(`/session?card=${questionCard.cardId}`);
    // The model answer must not be in the email, or the question answers itself.
    expect(html).not.toContain("idempotency key");
  });

  it("always has an unsubscribe and a pause link", () => {
    const html = renderSessionEmailHtml(input);
    expect(html).toContain("/api/email/unsubscribe?token=unsub-token");
    expect(html).toContain("/api/email/pause?token=pause-token");
    expect(html).toContain("/api/email/pause?token=pause-token&amp;for=forever");
    expect(renderSessionEmailText(input)).toContain(
      "/api/email/pause?token=pause-token&for=forever",
    );
  });

  it("mentions expired links with somewhere to go", () => {
    const html = renderSessionEmailHtml(input);
    expect(html).toContain("3 links expired since last time");
    expect(html).toContain("/inbox?status=expired");

    const none = renderSessionEmailHtml({ ...input, expiredSinceLast: 0 });
    expect(none).not.toContain("expired since last time");
  });

  it("escapes HTML from a page title, so it renders as text and cannot execute", () => {
    const html = renderSessionEmailHtml({
      ...input,
      items: [{ ...linkCard, title: '<img src=x onerror="alert(1)">' } as CardView],
    });

    // What matters is that no tag survives. The characters of "onerror" are still in the
    // document as inert text, which is correct: it is the angle brackets and the quotes
    // that would make it an attribute, and both are escaped.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("onerror=&quot;");
  });

  it("writes a plain text part with the same actions", () => {
    const text = renderSessionEmailText(input);
    expect(text).toContain("Choosing a Postgres index");
    expect(text).toContain("Read now: https://aeyhey.example.com/e/read-token");
    expect(text).toContain("Unsubscribe:");
    // No markup leaks into the text part.
    expect(text).not.toContain("<div");
    expect(text).not.toContain("style=");
  });

  it("writes a verification email with one clear action", () => {
    const mail = renderVerifyEmail({ publicUrl: "https://aeyhey.example.com", token: "verify-me" });
    expect(mail.subject).toMatch(/confirm/i);
    expect(mail.html).toContain("/api/email/verify?token=verify-me");
    expect(mail.text).toContain("/api/email/verify?token=verify-me");
  });

  it("uses no em dashes anywhere, per the project style", () => {
    const dashes = new RegExp("[\\u2013\\u2014]");
    expect(renderSessionEmailHtml(input)).not.toMatch(dashes);
    expect(renderSessionEmailText(input)).not.toMatch(dashes);
    expect(renderVerifyEmail({ publicUrl: "x", token: "y" }).html).not.toMatch(dashes);
  });
});

describe("notification summaries", () => {
  it("leads with the first link and the first question", () => {
    const seen = { ...questionCard, isNew: false } as CardView;
    const { title, body } = summarizeForNotification([linkCard, seen]);
    expect(title).toBe("2 cards ready");
    expect(body).toContain("Choosing a Postgres index");
    expect(body).toContain("idempotent");
  });

  it("gets the singular right", () => {
    expect(summarizeForNotification([linkCard]).title).toBe("1 card ready");
  });

  it("stays inside a notification's practical length", () => {
    const long = { ...linkCard, title: "x".repeat(400) } as CardView;
    expect(summarizeForNotification([long]).body.length).toBeLessThanOrEqual(160);
  });
});

describe("/pause in Telegram", () => {
  it("reads a week, a number of days, or forever", () => {
    expect(parsePauseCommand("/pause")).toEqual({ days: 7 });
    expect(parsePauseCommand("/pause@AeyheyBot")).toEqual({ days: 7 });
    expect(parsePauseCommand("/pause 3")).toEqual({ days: 3 });
    expect(parsePauseCommand("/pause 14 days")).toEqual({ days: 14 });
    expect(parsePauseCommand("/pause forever")).toEqual({ forever: true });
    expect(parsePauseCommand("/pause Off")).toEqual({ forever: true });
  });

  it("says how to use it rather than guessing", () => {
    expect(parsePauseCommand("/pause tomorrowish")).toBeNull();
    expect(parsePauseCommand("/pause 0")).toBeNull();
    expect(parsePauseCommand("/pause 365")).toBeNull();
  });

  it("tells the user how to undo an open-ended pause", () => {
    expect(pauseReply({ forever: true })).toContain("/resume");
  });
});
