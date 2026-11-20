// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { renderAssistantReply } from "../telegram-updates";

describe("Telegram assistant replies", () => {
  it("renders the same answer and sources returned by aey", () => {
    const text = renderAssistantReply({
      intent: "ask",
      reply: "A b-tree is the usual default.",
      answer: {
        found: true,
        sources: [
          {
            id: "link-1",
            kind: "link",
            title: "Choosing a Postgres index",
            href: "https://example.com/postgres-index",
          },
        ],
      },
    });

    expect(text).toContain("A b-tree is the usual default.");
    expect(text).toContain("Sources");
    expect(text).toContain("Choosing a Postgres index");
    expect(text).toContain("https://example.com/postgres-index");
  });

  it("turns assistant options into natural follow-up suggestions", () => {
    const text = renderAssistantReply({
      intent: "unclear",
      reply: "What would you like me to do with that?",
      options: [
        { label: "Make a deck on it", message: "transactions", force: "make_deck" },
        { label: "Find it in my library", message: "transactions", force: "ask" },
      ],
    });

    expect(text).toContain("You can say:");
    expect(text).toContain("Make a deck on it");
    expect(text).toContain("Find it in my library");
  });

  it("keeps messages within Telegram's text limit", () => {
    const text = renderAssistantReply({ intent: "help", reply: "x".repeat(5000) });
    expect(text.length).toBeLessThanOrEqual(4096);
  });
});
