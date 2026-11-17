// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import {
  dedupeQuestions,
  isNearDuplicate,
  jaccard,
  normalizeQuestion,
  similarity,
  SIMILARITY_THRESHOLD,
  trigrams,
} from "../../src/questions/dedupe";
import {
  parseResumeText,
  sniffFileKind,
  stripPii,
  UnsupportedResumeError,
  parseResumeFile,
} from "../../src/questions/resume-parse";
import { anchoredShare, generateQuestions } from "../../src/questions/generate";
import { describeProfile, normalizeProfile, profileAnchors } from "../../src/questions/profile";
import { gradeAnswer, gradeEmptyAnswer, selfRateFallback } from "../../src/questions/grade";
import { AiLimiter } from "../../src/ai/limiter";
import { AIBlockedError } from "../../src/extensions/usage";
import { NoAIProviderError } from "../../src/extensions/ai-credentials";
import type { AIKeyProvider } from "../../src/extensions/ai-credentials";
import type { UsageGate, UsageSink } from "../../src/extensions/usage";
import type { ResumeProfile } from "../../src/db/types";

const mockKeys: AIKeyProvider = {
  id: "mock",
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
    limiter: new AiLimiter({ maxConcurrency: 3, requestsPerMinute: 1000 }),
  };
}

describe("question normalization", () => {
  it("strips the polite framing models vary between runs", () => {
    expect(normalizeQuestion("Explain how a GIN index works.")).toBe("how a gin index works");
    expect(normalizeQuestion("Describe how a GIN index works.")).toBe("how a gin index works");
    expect(normalizeQuestion("Can you explain how a GIN index works?")).toBe(
      "how a gin index works",
    );
  });

  it("ignores case and punctuation", () => {
    expect(normalizeQuestion("What is a B-tree index?")).toBe(
      normalizeQuestion("what is a b tree index"),
    );
  });
});

describe("similarity", () => {
  it("treats a reworded question as the same question", () => {
    expect(
      similarity("How would you index this table?", "How do you index this table?"),
    ).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    expect(similarity("What is a b-tree index?", "What is a B-tree index?")).toBe(1);
  });

  it("keeps genuinely different questions apart", () => {
    expect(similarity("What is a b-tree index?", "What is a GIN index?")).toBeLessThan(
      SIMILARITY_THRESHOLD,
    );
    expect(similarity("Explain database normalization.", "Explain CAP theorem.")).toBeLessThan(0.3);
    // A narrower question is not a duplicate of a broader one.
    expect(
      similarity(
        "What is the difference between a b-tree and a GIN index?",
        "What is a b-tree index?",
      ),
    ).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it("does not merge two behavioral questions that differ in who they are about", () => {
    expect(
      isNearDuplicate(
        "Tell me about a time you disagreed with a manager.",
        "Tell me about a time you disagreed with a colleague.",
      ),
    ).toBe(false);
  });

  it("handles the empty cases without dividing by zero", () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(["abc"]), new Set())).toBe(0);
    expect(trigrams("").size).toBeGreaterThanOrEqual(0);
  });
});

describe("dedupeQuestions", () => {
  it("drops a near-duplicate of a question the user already has", () => {
    const result = dedupeQuestions(
      [{ text: "How do you index this table?" }, { text: "What is a GIN index?" }],
      ["How would you index this table?"],
    );

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]!.text).toBe("What is a GIN index?");
    expect(result.dropped[0]!.duplicateOf).toBe("How would you index this table?");
    expect(result.dropped[0]!.score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("keeps the first of a duplicate pair inside one batch", () => {
    const result = dedupeQuestions([
      { text: "What is a b-tree index?" },
      { text: "What is a B-tree index?" },
    ]);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it("keeps everything when nothing repeats", () => {
    const result = dedupeQuestions([
      { text: "Explain b-tree indexes." },
      { text: "Explain CAP theorem." },
      { text: "How does TCP handle congestion?" },
    ]);
    expect(result.kept).toHaveLength(3);
    expect(result.dropped).toHaveLength(0);
  });

  it("meets the acceptance criterion: generating twice adds no identical questions", () => {
    const firstRun = [{ text: "What is a b-tree index?" }, { text: "When would you use GIN?" }];
    const secondRun = [{ text: "What is a b-tree index?" }, { text: "Explain index selectivity." }];

    const result = dedupeQuestions(
      secondRun,
      firstRun.map((q) => q.text),
    );
    expect(result.kept.map((q) => q.text)).toEqual(["Explain index selectivity."]);
  });
});

describe("PII stripping", () => {
  it("removes emails and counts them", () => {
    const result = stripPii("Reach me at jane.roe+jobs@example.co.uk or not at all.");
    expect(result.text).not.toContain("jane.roe");
    expect(result.text).toContain("[email removed]");
    expect(result.emails).toBe(1);
  });

  it("removes phone numbers in the shapes people actually write", () => {
    for (const phone of [
      "+44 7700 900123",
      "(555) 123-4567",
      "555-123-4567",
      "+1 555 123 4567",
      "07700900123",
    ]) {
      const result = stripPii(`Call ${phone} any time.`);
      expect(result.phones, `did not strip ${phone}`).toBeGreaterThan(0);
      expect(result.text).toContain("[phone removed]");
    }
  });

  it("leaves a year, a version and a short number alone", () => {
    const result = stripPii("Shipped in 2024 using Postgres 16 across 12 teams.");
    expect(result.phones).toBe(0);
    expect(result.text).toContain("2024");
    expect(result.text).toContain("Postgres 16");
  });

  it("can be turned off, which is what the Ollama path does", () => {
    const parsed = parseResumeText("Email jane@example.com. ".repeat(60), { stripPii: false });
    expect(parsed.text).toContain("jane@example.com");
    expect(parsed.redactions.emails).toBe(0);
  });
});

describe("file sniffing", () => {
  it("recognises a PDF by its magic bytes, not its declared type", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nrest of the file");
    expect(sniffFileKind(pdf, "application/octet-stream")).toBe("pdf");
  });

  it("recognises a DOCX zip when the content type agrees", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(
      sniffFileKind(zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
    // A bare zip with no helpful content type is refused rather than guessed at.
    expect(sniffFileKind(zip, "application/zip")).toBeNull();
  });

  it("recognises plain text and refuses binary", () => {
    expect(sniffFileKind(new TextEncoder().encode("Jane Roe\nSenior Engineer"))).toBe("text");
    expect(sniffFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBeNull();
  });

  it("refuses an unsupported file with words the user can act on", async () => {
    await expect(
      parseResumeFile({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]) }),
    ).rejects.toThrow(UnsupportedResumeError);
  });
});

describe("resume text quality checks", () => {
  const realistic = `Jane Roe
Senior Backend Engineer

Experience
Acme Payments, Senior Engineer, 2022 to now
Built the idempotency layer for the payments service, handling retries across three providers.
Reduced duplicate charges to zero by keying every request and storing the response.
Led the migration from MySQL to Postgres with no downtime over four weeks.

Previous Co, Engineer, 2019 to 2022
Owned the notifications service, which sent about two million messages a day.
Introduced structured logging and cut incident triage time roughly in half.

Skills
TypeScript, Go, Postgres, Redis, Kubernetes, Terraform, AWS`;

  it("accepts a real resume without warning", () => {
    const parsed = parseResumeText(realistic);
    expect(parsed.suspicious).toBe(false);
    expect(parsed.note).toBeUndefined();
    expect(parsed.text).toContain("idempotency");
  });

  it("warns about text that is far too short, which usually means a scan", () => {
    const parsed = parseResumeText("Jane Roe\nEngineer");
    expect(parsed.suspicious).toBe(true);
    expect(parsed.note).toMatch(/short/i);
  });

  it("warns about garbled text", () => {
    const parsed = parseResumeText("###@@@%%%".repeat(60));
    expect(parsed.suspicious).toBe(true);
    expect(parsed.note).toMatch(/garbled/i);
  });

  it("warns when it only got part of a resume", () => {
    const parsed = parseResumeText("word ".repeat(50) + "and a bit more text here to pad it out.");
    expect(parsed.suspicious).toBe(true);
    expect(parsed.note).toMatch(/only part/i);
  });

  it("caps the stored text", () => {
    const parsed = parseResumeText("sentence of words ".repeat(5000));
    expect(parsed.text.length).toBeLessThanOrEqual(15_000);
  });
});

const profile: ResumeProfile = {
  headline: "Senior backend engineer",
  years_experience: 6,
  skills: [
    { name: "TypeScript", category: "language" },
    { name: "Postgres", category: "database" },
  ],
  experiences: [
    {
      company: "Acme Payments",
      role: "Senior Engineer",
      start: "2022",
      end: null,
      highlights: ["Built the idempotency layer"],
    },
  ],
  projects: [
    {
      name: "payments service",
      summary: "Handles retries across three providers.",
      tech: ["TypeScript", "Postgres"],
    },
  ],
  likely_interview_areas: ["Idempotency", "Database migrations"],
};

describe("profiles", () => {
  it("lists the anchors generation can hold onto", () => {
    const anchors = profileAnchors(profile);
    expect(anchors).toContain("payments service");
    expect(anchors).toContain("Acme Payments");
    expect(anchors).toContain("Postgres");
  });

  it("describes what it understood, for the review screen", () => {
    expect(describeProfile(profile)).toContain("6 years");
    expect(describeProfile(profile)).toContain("1 projects");
  });

  it("fills the loose optional fields so storage is predictable", () => {
    const normalized = normalizeProfile({
      ...profile,
      experiences: [{ company: "X", role: "Y", highlights: [] }],
    });
    expect(normalized.experiences[0]!.start).toBeNull();
    expect(normalized.experiences[0]!.end).toBeNull();
  });
});

describe("anchoredShare", () => {
  it("counts a question that names a real project", () => {
    const share = anchoredShare(
      [
        {
          text: "In your payments service, how did you handle idempotency?",
          model_answer: "x".repeat(50),
          key_points: ["a", "b"],
          tags: ["apis"],
          category: "project_deep_dive",
          difficulty: "medium",
          resume_anchor: null,
        },
        {
          text: "What is a b-tree index?",
          model_answer: "x".repeat(50),
          key_points: ["a", "b"],
          tags: ["postgres"],
          category: "concept",
          difficulty: "easy",
          resume_anchor: null,
        },
      ],
      profile,
    );
    expect(share).toBe(0.5);
  });

  it("counts an explicit resume_anchor even when the text does not name it", () => {
    const share = anchoredShare(
      [
        {
          text: "Walk me through the hardest bug you fixed there.",
          model_answer: "x".repeat(50),
          key_points: ["a", "b"],
          tags: ["debugging"],
          category: "project_deep_dive",
          difficulty: "hard",
          resume_anchor: "payments service",
        },
      ],
      profile,
    );
    expect(share).toBe(1);
  });

  it("is 0 with no questions or no anchors", () => {
    expect(anchoredShare([], profile)).toBe(0);
    expect(
      anchoredShare(
        [
          {
            text: "A question",
            model_answer: "x".repeat(50),
            key_points: ["a", "b"],
            tags: ["t"],
            category: "concept",
            difficulty: "easy",
            resume_anchor: null,
          },
        ],
        { ...profile, projects: [], experiences: [], skills: [] },
      ),
    ).toBe(0);
  });
});

describe("generateQuestions", () => {
  it("batches until it reaches the count asked for", async () => {
    const result = await generateQuestions(deps(), {
      userId: "u1",
      sourceId: "s1",
      mode: "topics",
      // Several topics, so there is genuinely that much distinct material to ask about.
      topics: ["Postgres indexing", "system design", "concurrency"],
      count: 25,
    });

    expect(result.questions).toHaveLength(25);
    // The model is only asked for 10 at a time, so this needs at least three calls.
    expect(result.batches).toBeGreaterThanOrEqual(3);
  });

  it("returns exactly what was asked for when that is under one batch", async () => {
    const result = await generateQuestions(deps(), {
      userId: "u1",
      sourceId: "s1",
      mode: "topics",
      topics: ["Postgres"],
      count: 4,
    });
    expect(result.questions).toHaveLength(4);
    expect(result.batches).toBe(1);
  });

  it("stops and explains when the model runs out of distinct questions", async () => {
    const mock = await import("../../src/ai/mock");
    // Always the same single question, so every batch after the first is a duplicate.
    const spy = vi.spyOn(mock, "mockObjectFor").mockReturnValue({
      questions: [
        {
          text: "What is a b-tree index?",
          model_answer: "An answer long enough to satisfy the contract's minimum length.",
          key_points: ["ordered", "range queries"],
          tags: ["postgres"],
          category: "concept",
          difficulty: "easy",
          resume_anchor: null,
        },
      ],
    });

    const result = await generateQuestions(deps(), {
      userId: "u1",
      sourceId: "s1",
      mode: "topics",
      topics: ["Postgres"],
      count: 20,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.duplicatesDropped).toBeGreaterThan(0);
    expect(result.shortfallReason).toMatch(/ran out of distinct/i);
    spy.mockRestore();
  });

  it("keeps what it already wrote when the provider dies partway", async () => {
    const mock = await import("../../src/ai/mock");
    let calls = 0;
    const spy = vi.spyOn(mock, "mockObjectFor").mockImplementation(() => {
      calls += 1;
      if (calls > 1) throw new Error("provider exploded");
      const stems = [
        "What does a b-tree index cost you on write?",
        "When is a partial index the right answer?",
        "How would you find an unused index in production?",
        "Why does a GIN index help with jsonb containment?",
        "What goes wrong with an index on a low cardinality column?",
        "How do you choose the column order in a composite index?",
        "When would a covering index pay for itself?",
        "What happens to an index during a bulk load?",
        "How would you measure whether an index is earning its keep?",
        "Why can adding an index make a query slower?",
      ];
      return {
        questions: stems.map((text) => ({
          text,
          model_answer: "An answer long enough to satisfy the contract's minimum length.",
          key_points: ["one point", "a second point"],
          tags: ["postgres"],
          category: "concept",
          difficulty: "medium",
          resume_anchor: null,
        })),
      };
    });

    const result = await generateQuestions(deps(), {
      userId: "u1",
      sourceId: "s1",
      mode: "topics",
      topics: ["Postgres"],
      count: 25,
    });

    // Ten good questions beat throwing the work away.
    expect(result.questions).toHaveLength(10);
    expect(result.shortfallReason).toBeTruthy();
    spy.mockRestore();
  });

  it("propagates a blocked call when nothing was written yet", async () => {
    await expect(
      generateQuestions(
        deps({
          gate: {
            async check() {
              return { allow: false, reason: "no_credits", message: "Out of credits." };
            },
          },
        }),
        { userId: "u1", sourceId: "s1", mode: "topics", topics: ["Postgres"], count: 10 },
      ),
    ).rejects.toThrow(AIBlockedError);
  });
});

describe("grading", () => {
  const question = {
    userId: "u1",
    questionId: "q1",
    question: "How do you make a payment endpoint idempotent?",
    modelAnswer: "Use an idempotency key stored with the response.",
    keyPoints: [
      "Client sends a unique idempotency key",
      "Server stores the key with the response",
      "A repeat request returns the stored response",
    ],
    difficulty: "medium" as const,
  };

  it("scores a good answer above a vague one", async () => {
    const good = await gradeAnswer(deps(), {
      ...question,
      userAnswer:
        "The client sends a unique idempotency key. The server stores that key with the response, so a repeat request returns the stored response rather than charging again.",
    });
    const vague = await gradeAnswer(deps(), {
      ...question,
      userAnswer: "You should probably use a database for it somehow.",
    });

    expect(good.result!.score).toBeGreaterThan(vague.result!.score);
    expect(good.via).toBe("ai");
  });

  it("derives the rating from the score, not from the model's own suggestion", async () => {
    const result = await gradeAnswer(deps(), {
      ...question,
      userAnswer:
        "The client sends a unique idempotency key. The server stores that key with the response, so a repeat request returns the stored response.",
    });

    const expected =
      result.result!.score >= 90
        ? "easy"
        : result.result!.score >= 65
          ? "good"
          : result.result!.score >= 40
            ? "hard"
            : "again";
    expect(result.suggestedRatingWord).toBe(expected);
  });

  it("scores an empty or one-word answer 0 with no AI call", async () => {
    const sink: UsageSink = { async record() {} };
    const recorded: unknown[] = [];
    const tracking = {
      ...deps(),
      sink: {
        async record(event: unknown) {
          recorded.push(event);
          await sink.record(event as never);
        },
      },
    };

    const result = await gradeAnswer(tracking, { ...question, userAnswer: "   " });

    expect(result.result!.score).toBe(0);
    expect(result.via).toBe("empty_answer");
    expect(result.suggestedRatingWord).toBe("again");
    // Nothing was spent, so nothing is metered.
    expect(recorded).toHaveLength(0);
    // The user still gets the answer and the full list of what they missed.
    expect(result.modelAnswer).toBe(question.modelAnswer);
    expect(result.result!.missed_points).toHaveLength(3);
  });

  it("treats 'idk' as an empty answer", async () => {
    const result = await gradeAnswer(deps(), { ...question, userAnswer: "idk" });
    expect(result.via).toBe("empty_answer");
  });

  it("falls back to self-rating when no provider is configured", async () => {
    const result = await gradeAnswer(
      deps({
        keys: {
          id: "none",
          async resolve() {
            throw new NoAIProviderError();
          },
        },
      }),
      { ...question, userAnswer: "A real attempt at an answer about idempotency keys." },
    );

    expect(result.result).toBeNull();
    expect(result.via).toBe("fallback");
    expect(result.suggestedRatingWord).toBe("hard");
    expect(result.notice).toMatch(/no ai provider/i);
    // The answer is still shown, so the review is not wasted.
    expect(result.modelAnswer).toBe(question.modelAnswer);
  });

  it("falls back when the grader returns nonsense", async () => {
    const mock = await import("../../src/ai/mock");
    const spy = vi.spyOn(mock, "mockObjectFor").mockReturnValue({ nope: true });

    const result = await gradeAnswer(deps(), {
      ...question,
      userAnswer: "A real attempt at an answer about idempotency keys and stored responses.",
    });

    expect(result.result).toBeNull();
    expect(result.via).toBe("fallback");
    expect(result.notice).toMatch(/grade yourself/i);
    spy.mockRestore();
  });

  it("propagates a blocked call so the user hears about credits", async () => {
    await expect(
      gradeAnswer(
        deps({
          gate: {
            async check() {
              return { allow: false, reason: "no_credits", message: "Out of credits." };
            },
          },
        }),
        { ...question, userAnswer: "A real attempt at a full answer about idempotency." },
      ),
    ).rejects.toThrow(AIBlockedError);
  });

  it("pre-selects Hard for a plain reveal", () => {
    const fallback = selfRateFallback({ modelAnswer: "The answer." });
    expect(fallback.suggestedRatingWord).toBe("hard");
    expect(fallback.result).toBeNull();
  });

  it("lists every key point as missed for an empty answer", () => {
    const result = gradeEmptyAnswer({ keyPoints: ["a", "b"], modelAnswer: "x" });
    expect(result.result!.missed_points).toEqual(["a", "b"]);
    expect(result.result!.verdict).toBe("incorrect");
  });
});
