// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { mockObjectFor } from "../../src/ai/mock";
import { buildGenerateQuestionsPrompt } from "../../src/ai/prompts/generate-questions";

type MockQuestion = { text: string; key_points: string[]; category: string };

function questionsFor(topics: string[], style: "interview" | "study" = "study"): MockQuestion[] {
  const prompt = buildGenerateQuestionsPrompt({ mode: "topics", topics, style, count: 5 });
  return (mockObjectFor("generate_questions", prompt) as { questions: MockQuestion[] }).questions;
}

describe("mock questions", () => {
  it("asks study questions about a school subject, not software ones", () => {
    const questions = questionsFor(["Physics"]);
    expect(questions).toHaveLength(5);
    for (const question of questions) {
      expect(question.text).not.toMatch(/load|production|shipping|downstream|never used/i);
      expect(question.category).toBe("concept");
    }
    expect(questions[0]!.text).toBe("What is the central idea of Physics, in your own words?");
  });

  it("keeps the engineering questions for software topics", () => {
    const questions = questionsFor(["Redis caching"], "interview");
    expect(questions.map((q) => q.text)).toContain(
      "What breaks first if Redis caching has to handle ten times the load?",
    );
  });

  it("gives each topic in a mixed list the questions that fit it", () => {
    const texts = questionsFor(["Postgres indexing", "The French Revolution"]).map((q) => q.text);
    expect(texts).toContain(
      "How would you explain Postgres indexing to someone who has never used it?",
    );
    expect(texts).toContain(
      "What is the central idea of The French Revolution, in your own words?",
    );
    expect(texts.join(" ")).not.toMatch(/French Revolution has to handle/);
  });
});
