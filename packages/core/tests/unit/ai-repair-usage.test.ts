// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoObjectGeneratedError, generateObject } from "ai";
import type * as AiSdk from "ai";
import { AiLimiter, callAi, LINK_SUMMARY_SYSTEM } from "../../src/ai/index";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import type { AIUsageEvent, UsageGate, UsageSink } from "../../src/extensions/usage";

vi.mock("ai", async (importOriginal) => {
  const original = await importOriginal<typeof AiSdk>();
  return { ...original, generateObject: vi.fn() };
});

const mockedGenerateObject = vi.mocked(generateObject);

describe("repair attempt usage", () => {
  beforeEach(() => mockedGenerateObject.mockReset());

  it("records tokens from the failed first attempt and successful repair", async () => {
    const recorded: AIUsageEvent[] = [];
    const keys: AIKeyProvider = {
      id: "test",
      async resolve() {
        return {
          provider: "openai",
          model: "test-model",
          apiKey: "test-key",
          source: "env",
        };
      },
    };
    const gate: UsageGate = {
      async check() {
        return { allow: true };
      },
    };
    const sink: UsageSink = {
      async record(event) {
        recorded.push(event);
      },
    };

    mockedGenerateObject
      .mockRejectedValueOnce(
        new NoObjectGeneratedError({
          message: "invalid object",
          text: "not json",
          response: { id: "first", timestamp: new Date(), modelId: "test-model" },
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          finishReason: "stop",
        }),
      )
      .mockResolvedValueOnce({
        object: {
          summary_lines: ["First", "Second", "Third"],
          why_saved: "Useful reference",
          tags: ["testing"],
          content_type: "article",
          read_minutes: 2,
          language: "en",
          confidence: "high",
        },
        usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
      } as Awaited<ReturnType<typeof generateObject>>);

    const result = await callAi(
      {
        keys,
        gate,
        sink,
        limiter: new AiLimiter({ maxConcurrency: 1, requestsPerMinute: 10 }),
      },
      {
        contract: "link_summary",
        userId: "user-1",
        system: LINK_SUMMARY_SYSTEM,
        prompt: "Summarize this article.",
      },
    );

    expect(result).toMatchObject({ inputTokens: 180, outputTokens: 50, repaired: true });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      ok: true,
      inputTokens: 180,
      outputTokens: 50,
    });
  });
});
