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
