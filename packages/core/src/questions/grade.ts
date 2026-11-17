// SPDX-License-Identifier: AGPL-3.0-only
// Grading a written answer (PRD 8.3 FR-S-3, 9.3, 13.4).
//
// The rule that governs this whole module: grading never blocks scheduling. If the grader
// fails, times out, or there is no provider at all, the user is shown the model answer and
// asked to rate themselves, exactly as the Reveal path works. A broken grader costs
// feedback, never a review.
//
// The server derives the suggested rating from the score, not from the model's own
// suggested_rating, so intervals stay consistent whichever model is configured.

import type { Difficulty, GradeResult } from "../db/types";
import { callAi, type AiCallDeps } from "../ai/call";
import { AiContractError, AiProviderError } from "../ai/call";
import {
  buildGradeAnswerPrompt,
  GRADE_ANSWER_SYSTEM,
  isTriviallyEmpty,
} from "../ai/prompts/grade-answer";
import { ratingFromScore, ratingToWord, type Grade } from "../scheduler/scheduler";
import { AIBlockedError } from "../extensions/usage";
import { NoAIProviderError } from "../extensions/ai-credentials";
import { createLogger } from "../logger";

const log = createLogger("grade");

export interface GradeAnswerInput {
  userId: string;
  questionId: string;
  question: string;
  modelAnswer: string;
  keyPoints: string[];
  userAnswer: string;
  difficulty: Difficulty;
  level?: string | null;
  jobId?: string;
}

export interface GradedAnswer {
  /** null when we could not grade, which means fall back to self-rating. */
  result: GradeResult | null;
  /** The rating the server suggests, always present so the UI has a default. */
  suggestedRating: Grade;
  suggestedRatingWord: "again" | "hard" | "good" | "easy";
  /** Always sent once the user has answered: they have earned the answer. */
  modelAnswer: string;
  /** How the grade was reached, so the UI can be honest about it. */
  via: "ai" | "empty_answer" | "fallback";
  /** Shown as a small notice when grading did not work. */
  notice?: string;
}

/** An empty or one-word answer scores 0 locally, with no AI call (PRD 13.4). */
export function gradeEmptyAnswer(input: {
  keyPoints: string[];
  modelAnswer: string;
}): GradedAnswer {
  return {
    result: {
      score: 0,
      verdict: "incorrect",
      covered_points: [],
      missed_points: input.keyPoints,
      mistakes: [],
      feedback:
        "Nothing to grade there. Read the answer below, then try saying it back in your own words.",
      suggested_rating: "again",
    },
    suggestedRating: ratingFromScore(0),
    suggestedRatingWord: "again",
    modelAnswer: input.modelAnswer,
    via: "empty_answer",
  };
}

/** The Reveal path, and the path a failed grader falls back to (PRD 12.3). */
export function selfRateFallback(input: { modelAnswer: string; notice?: string }): GradedAnswer {
  return {
    result: null,
    // Leaving a reveal unrated counts as Hard, so Hard is the sensible default here too
    // (PRD 9.3).
    suggestedRating: 2 as Grade,
    suggestedRatingWord: "hard",
    modelAnswer: input.modelAnswer,
    via: "fallback",
    ...(input.notice ? { notice: input.notice } : {}),
  };
}

export async function gradeAnswer(
  deps: AiCallDeps,
  input: GradeAnswerInput,
): Promise<GradedAnswer> {
  // No call needed, and no money spent, for an answer that is not one.
  if (isTriviallyEmpty(input.userAnswer)) {
    return gradeEmptyAnswer({ keyPoints: input.keyPoints, modelAnswer: input.modelAnswer });
  }

  try {
    const result = await callAi(deps, {
      contract: "grade_answer",
      userId: input.userId,
      system: GRADE_ANSWER_SYSTEM,
      prompt: buildGradeAnswerPrompt({
        question: input.question,
        modelAnswer: input.modelAnswer,
        keyPoints: input.keyPoints,
        userAnswer: input.userAnswer,
        difficulty: input.difficulty,
        level: input.level ?? null,
      }),
      ref: { type: "question", id: input.questionId },
      ...(input.jobId ? { jobId: input.jobId } : {}),
    });

    const graded = result.object;
    // The model's own suggested_rating is stored in `result` but not used. The score is
    // the single source of the rating, so two models cannot schedule differently.
    const rating = ratingFromScore(graded.score);

    return {
      result: graded,
      suggestedRating: rating,
      suggestedRatingWord: ratingToWord(rating),
      modelAnswer: input.modelAnswer,
      via: "ai",
    };
  } catch (error) {
    // Being out of credits is worth telling the user about plainly, and it is the one
    // case where the caller may want to react, so it propagates.
    if (error instanceof AIBlockedError) throw error;

    if (error instanceof NoAIProviderError) {
      return selfRateFallback({
        modelAnswer: input.modelAnswer,
        notice: "No AI provider is set up, so grade yourself against the answer below.",
      });
    }

    if (error instanceof AiContractError || error instanceof AiProviderError) {
      log.warn("grading failed, falling back to self-rating", {
        questionId: input.questionId,
        error: error.message,
      });
      return selfRateFallback({
        modelAnswer: input.modelAnswer,
        notice: "Grading did not work this time, so grade yourself against the answer below.",
      });
    }

    throw error;
  }
}
