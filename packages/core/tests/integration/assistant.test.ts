// SPDX-License-Identifier: AGPL-3.0-only
// The assistant: what it decides a message means, and what it does about it, against the
// demo library with the mock provider, and with no provider at all.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiLimiter } from "../../src/ai/index";
import type { AiCallDeps } from "../../src/ai/call";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import { readMessage, searchWords } from "../../src/assistant/rules";
import { respond, type AssistantDeps } from "../../src/assistant/respond";
import { searchLibrary } from "../../src/assistant/search";
import { scopeFor } from "../../src/repos/context";
import type { Scope } from "../../src/repos/context";
import { seedDemoData } from "../../src/seed/index";
import { createTestDb, type TestDb } from "../helpers/db";

const mockKeys: AIKeyProvider = {
  id: "test",
  async resolve() {
    return { provider: "mock", model: "mock", source: "env" };
  },
};

/** Keys that resolve to nothing, as on an instance with no AI provider set up. */
const noKeys: AIKeyProvider = {
  id: "none",
  async resolve() {
    throw new Error("No AI provider is set up.");
  },
};

function aiDeps(keys: AIKeyProvider): AiCallDeps {
  return {
    keys,
    gate: {
      async check() {
        return { allow: true as const };
      },
    },
    sink: { async record() {} },
    limiter: new AiLimiter({ maxConcurrency: 3, requestsPerMinute: 600 }),
  };
}

describe("reading a message without a model", () => {
  it("knows links, questions and topic lists when it sees them", () => {
    expect(readMessage("https://example.com/a and https://example.com/b").intent).toBe(
      "save_links",
    );
    expect(readMessage("what did I save about postgres?").intent).toBe("ask");
    expect(readMessage("Kafka, Raft and consensus")).toMatchObject({
      intent: "make_deck",
      topics: ["Kafka", "Raft", "consensus"],
      sure: true,
    });
  });

  it("asks when a short phrase could be a topic or a search", () => {
    expect(readMessage("postgres")).toMatchObject({ intent: "unclear", sure: false });
  });

  it("keeps only the words worth searching for", () => {
    expect(searchWords("What did I save about Postgres indexes?")).toEqual(["postgres", "indexes"]);
  });
});

describe("the assistant on the demo library", () => {
  let db: TestDb;
  let scope: Scope;
  let saved: string[];
  const deps = (keys: AIKeyProvider): AssistantDeps => ({
    ai: aiDeps(keys),
    async saveLinks(text) {
      saved.push(text);
      return { created: [{ id: "new", url: "https://example.com/new" }], duplicates: [] };
    },
  });

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedDemoData(db.handle);
    scope = scopeFor(db.handle, seeded!.userId);
    saved = [];
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it("saves links straight away and says so", async () => {
    const reply = await respond(scope, deps(mockKeys), { message: "https://example.com/new" });
    expect(reply.intent).toBe("save_links");
    expect(saved).toHaveLength(1);
    expect(reply.saved?.created).toBe(1);
    expect(reply.reply).toMatch(/Saved 1 link/);
  });

  it("proposes a deck rather than writing one", async () => {
    const reply = await respond(scope, deps(mockKeys), { message: "Kafka, Raft and consensus" });
    expect(reply.intent).toBe("make_deck");
    expect(reply.proposal).toMatchObject({
      topics: ["Kafka", "Raft", "consensus"],
      level: "intermediate",
      style: "study",
    });
    expect(saved).toHaveLength(0);
  });

  it("answers a question from the library, with the pieces it used", async () => {
    const reply = await respond(scope, deps(mockKeys), {
      message: "What did I save about Kafka?",
    });
    expect(reply.intent).toBe("ask");
    expect(reply.answer?.found).toBe(true);
    expect(reply.answer?.sources.length).toBeGreaterThan(0);
    expect(reply.answer?.sources.some((source) => /kafka/i.test(source.title))).toBe(true);
  });

  it("says so when nothing saved answers it, and offers a deck", async () => {
    const reply = await respond(scope, deps(mockKeys), {
      message: "What did I save about medieval tapestry?",
    });
    expect(reply.answer?.found).toBe(false);
    expect(reply.options?.[0]?.force).toBe("make_deck");
  });

  it("asks which was meant, and a button settles it", async () => {
    const asked = await respond(scope, deps(mockKeys), { message: "postgres" });
    expect(asked.intent).toBe("unclear");
    expect(asked.options?.map((option) => option.force)).toEqual(["make_deck", "ask"]);

    const deck = await respond(scope, deps(mockKeys), { message: "postgres", force: "make_deck" });
    expect(deck.proposal?.topics).toEqual(["postgres"]);
    const found = await respond(scope, deps(mockKeys), { message: "postgres", force: "ask" });
    expect(found.answer?.found).toBe(true);
  });

  it("still works with no AI provider at all", async () => {
    const links = await respond(scope, deps(noKeys), { message: "https://example.com/new" });
    expect(links.saved?.created).toBe(1);

    const unclear = await respond(scope, deps(noKeys), { message: "postgres" });
    expect(unclear.intent).toBe("unclear");

    const answer = await respond(scope, deps(noKeys), { message: "What did I save about Kafka?" });
    expect(answer.answer?.found).toBe(true);
    expect(answer.reply).toMatch(/I found/);
  });

  it("answers questions about Aeyhey itself from its own help, with or without a model", async () => {
    for (const keys of [mockKeys, noKeys]) {
      const deck = await respond(scope, deps(keys), { message: "what is deck?" });
      expect(deck.intent).toBe("help");
      expect(deck.reply).toMatch(/A deck is a set of practice questions/);
      expect(deck.options).toBeUndefined();

      const app = await respond(scope, deps(keys), {
        message: "what aeyhey can do? what is its purpose?",
      });
      expect(app.intent).toBe("help");
      expect(app.reply).toMatch(/Aeyhey helps you remember/);
    }
  });

  it("keeps questions about what you learn and save off the help", async () => {
    expect(readMessage("what are topics in physics?").intent).toBe("ask");
    expect(readMessage("What did I save about decks?").intent).toBe("ask");
    expect(readMessage("what is a black hole?").intent).toBe("ask");
    expect(readMessage("how do I make a deck?").intent).toBe("help");
  });

  it("finds questions and links by their tags as well as their words", async () => {
    const hits = await searchLibrary(scope, "organic chemistry");
    expect(hits.some((hit) => hit.kind === "question")).toBe(true);
    expect(hits.some((hit) => hit.kind === "link")).toBe(true);
  });
});
