// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { matchTag, normalizeTag, resolveTags, tagLabel } from "../../src/links/tags";
import { enrichLink, withoutAi } from "../../src/links/enrich";
import { AiLimiter } from "../../src/ai/limiter";
import { AIBlockedError } from "../../src/extensions/usage";
import { NoAIProviderError } from "../../src/extensions/ai-credentials";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import type { UsageGate, UsageSink } from "../../src/extensions/usage";
import type { ExtractedContent } from "../../src/links/extract/types";

describe("normalizeTag", () => {
  it("produces lowercase kebab-case", () => {
    expect(normalizeTag("Machine Learning")).toBe("machine-learning");
    expect(normalizeTag("PostgreSQL")).toBe("postgresql");
    expect(normalizeTag("  spaced  out  ")).toBe("spaced-out");
    expect(normalizeTag("snake_case")).toBe("snake-case");
    expect(normalizeTag("with/slash")).toBe("with-slash");
  });

  it("strips a leading hash, which people type out of habit", () => {
    expect(normalizeTag("#webdev")).toBe("webdev");
    expect(normalizeTag("##webdev")).toBe("webdev");
  });

  it("keeps the characters that carry meaning in a tech tag", () => {
    expect(normalizeTag("c++")).toBe("c++");
    expect(normalizeTag("c#")).toBe("c#");
  });

  it("keeps accented letters, so a non-English tag still works", () => {
    expect(normalizeTag("Programación")).toBe("programación");
  });

  it("refuses what is not a usable tag", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("2024")).toBeNull();
    expect(normalizeTag("!!!")).toBeNull();
    expect(normalizeTag("x".repeat(40))).toBeNull();
  });

  it("collapses runs of separators", () => {
    expect(normalizeTag("a---b")).toBe("a-b");
    expect(normalizeTag("-leading-and-trailing-")).toBe("leading-and-trailing");
  });
});

describe("matchTag", () => {
  const existing = ["postgres", "databases", "machine-learning", "css"];

  it("reuses an exact existing tag", () => {
    expect(matchTag("Postgres", existing)).toEqual({ name: "postgres", matchedExisting: true });
  });

  it("matches a plural against an existing singular and the other way round", () => {
    expect(matchTag("database", existing)).toEqual({ name: "databases", matchedExisting: true });
    expect(matchTag("postgreses", existing)).toEqual({ name: "postgres", matchedExisting: true });
  });

  it("handles the ies and y pair", () => {
    expect(matchTag("categories", ["category"])).toEqual({
      name: "category",
      matchedExisting: true,
    });
    expect(matchTag("category", ["categories"])).toEqual({
      name: "categories",
      matchedExisting: true,
    });
  });

  it("does not strip the s from a word that ends in ss", () => {
    expect(matchTag("css", existing)?.name).toBe("css");
  });

  it("creates a new tag when nothing matches", () => {
    expect(matchTag("rust", existing)).toEqual({ name: "rust", matchedExisting: false });
  });

  it("leaves genuinely different tags alone, rather than guessing them together", () => {
    // "postgresql" is the same idea as "postgres" to a human, but merging them would
    // eventually merge two tags the user meant to keep apart.
    expect(matchTag("postgresql", existing)?.matchedExisting).toBe(false);
  });
});

describe("resolveTags", () => {
  it("dedupes, reuses existing tags and keeps the model's order", () => {
    expect(resolveTags(["Postgres", "postgres", "Databases", "Indexing"], ["postgres"])).toEqual([
      "postgres",
      "databases",
      "indexing",
    ]);
  });

  it("drops unusable tags instead of failing", () => {
    expect(resolveTags(["", "2024", "!!!", "rust"], [])).toEqual(["rust"]);
  });

  it("caps the count", () => {
    expect(resolveTags(["a1", "b2", "c3", "d4", "e5", "f6", "g7"], [], 5)).toHaveLength(5);
  });

  it("dedupes through the plural match, not just the exact one", () => {
    expect(resolveTags(["database", "databases"], ["databases"])).toEqual(["databases"]);
  });
});

describe("tagLabel", () => {
  it("reads as a sentence in the UI", () => {
    expect(tagLabel("machine-learning")).toBe("Machine learning");
    expect(tagLabel("postgres")).toBe("Postgres");
  });
});

// ---------------------------------------------------------------- enrichment

const extracted: ExtractedContent = {
  status: "ok",
  title: "Choosing a Postgres index",
  siteName: "Example Blog",
  contentType: "article",
  text: "A long article about b-tree and GIN indexes in Postgres, and when to choose each one.",
  language: "en",
};

const mockKeys: AIKeyProvider = {
  id: "test",
  async resolve() {
    return { provider: "mock", model: "mock", source: "env" };
  },
};

function deps(overrides: { keys?: AIKeyProvider; gate?: UsageGate } = {}) {
  const sink: UsageSink = { async record() {} };
  return {
    keys: overrides.keys ?? mockKeys,
    gate:
      overrides.gate ??
      ({
        async check() {
          return { allow: true as const };
        },
      } satisfies UsageGate),
    sink,
    limiter: new AiLimiter({ maxConcurrency: 3, requestsPerMinute: 60 }),
  };
}

const baseInput = {
  userId: "u1",
  linkId: "l1",
  url: "https://example.com/postgres-index",
  savedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("enrichLink", () => {
  it("produces the three lines, the why, the tags and the rest", async () => {
    const result = await enrichLink(deps(), { ...baseInput, extracted });

    expect(result.aiStatus).toBe("ok");
    expect(result.summaryLines).toHaveLength(3);
    expect(result.whySaved).toBeTruthy();
    expect(result.tags.length).toBeGreaterThan(0);
    expect(result.summaryConfidence).toBe("high");
    expect(result.readMinutes).toBeGreaterThanOrEqual(1);
    expect(result.language).toBe("en");
  });

  it("reuses the user's existing tags rather than inventing near-duplicates", async () => {
    const result = await enrichLink(deps(), {
      ...baseInput,
      extracted,
      existingTags: ["example", "demos"],
    });
    // The mock tags a link with its host and "demo"; "demo" should match "demos".
    expect(result.tags).toContain("demos");
  });

  it("forces confidence low when extraction only had the title", async () => {
    const result = await enrichLink(deps(), {
      ...baseInput,
      extracted: { status: "failed", title: "A page we could not fetch", contentType: "article" },
    });
    expect(result.summaryConfidence).toBe("low");
    expect(result.note).toMatch(/title only/i);
  });

  it("skips cleanly when there was nothing readable at all", async () => {
    const result = await enrichLink(deps(), {
      ...baseInput,
      extracted: { status: "failed", contentType: "other", note: "404" },
    });
    expect(result.aiStatus).toBe("skipped");
    expect(result.summaryLines).toBeNull();
    // Still a usable record: the link is not lost.
    expect(result.contentType).toBe("other");
  });

  it("keeps the link when no AI provider is configured", async () => {
    const result = await enrichLink(
      deps({
        keys: {
          id: "none",
          async resolve() {
            throw new NoAIProviderError();
          },
        },
      }),
      { ...baseInput, extracted },
    );

    expect(result.aiStatus).toBe("skipped");
    expect(result.note).toMatch(/no ai provider/i);
    // Read minutes still come from the extracted text, with no model involved.
    expect(result.readMinutes).toBeGreaterThanOrEqual(1);
  });

  it("keeps the link when the model produces nothing valid", async () => {
    const mock = await import("../../src/ai/mock");
    const spy = vi.spyOn(mock, "mockObjectFor").mockReturnValue({ garbage: true });

    const result = await enrichLink(deps(), { ...baseInput, extracted });

    expect(result.aiStatus).toBe("failed");
    expect(result.summaryLines).toBeNull();
    expect(result.contentType).toBe("article");
    expect(result.note).toBeTruthy();
    spy.mockRestore();
  });

  it("rethrows a blocked call, so the job is blocked rather than marked failed", async () => {
    await expect(
      enrichLink(
        deps({
          gate: {
            async check() {
              return { allow: false, reason: "no_credits", message: "Out of credits." };
            },
          },
        }),
        { ...baseInput, extracted },
      ),
    ).rejects.toThrow(AIBlockedError);
  });

  it("uses the user's note, which is the strongest hint about why they saved it", async () => {
    const result = await enrichLink(deps(), {
      ...baseInput,
      extracted,
      userNote: "for the Postgres migration",
    });
    expect(result.whySaved).toContain("Postgres migration");
  });
});

describe("withoutAi", () => {
  it("is a complete, usable record with no model involved", () => {
    const result = withoutAi({ extracted, reason: "No provider." });
    expect(result.aiStatus).toBe("failed");
    expect(result.contentType).toBe("article");
    expect(result.readMinutes).toBeGreaterThanOrEqual(1);
    expect(result.tags).toEqual([]);
  });
});
