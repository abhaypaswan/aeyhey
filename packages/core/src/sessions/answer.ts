// SPDX-License-Identifier: AGPL-3.0-only
// Answer and Reveal (PRD 8.3 FR-S-3, 9.3, 13.4).
//
// These two live apart from the other card actions because they need the grader, and
// because neither of them schedules anything. The user answers or reveals, sees the model
// answer, and then rates. That rating is the scheduling event, and it goes through
// applyCardAction like every other one.
//
// Why the split matters: it means a grader that times out cannot leave a card in a
// half-scheduled state. Nothing has been written yet.

import type { Channel } from "../db/types";
import { findCardById } from "../repos/cards";
import { findQuestion, saveGrade } from "../repos/questions";
import { loadSettings } from "../repos/settings";
import { gradeAnswer, selfRateFallback, type GradedAnswer } from "../questions/grade";
import { ratingToWord } from "../scheduler/scheduler";
import type { AiCallDeps } from "../ai/call";
import type { Scope } from "../repos/context";
import { CardNotFoundError, WrongCardKindError } from "./actions";
import { createLogger } from "../logger";

const log = createLogger("answer");

export interface AnswerResult {
  /** null when grading could not run. The UI then asks the user to self-rate. */
  grade: GradedAnswer["result"];
  /** Always set, so the rating buttons have a sensible default pre-selected. */
  suggestedRating: number;
  suggestedRatingWord: "again" | "hard" | "good" | "easy";
  modelAnswer: string;
  /** Links the grade to the review when the user confirms a rating. */
  gradeId: string | null;
  via: GradedAnswer["via"];
  notice?: string;
}

export interface AnswerContext {
  scope: Scope;
  ai: AiCallDeps;
  sessionId?: string | null;
  channel?: Channel;
}

/**
 * Grades a written answer. Does not touch the card: the rating that follows does.
 * The grade is stored so the rating can link to it, and so the stats page can show
 * score by tag later.
 */
export async function answerQuestion(
  ctx: AnswerContext,
  cardId: string,
  userAnswer: string,
): Promise<AnswerResult> {
  const { scope } = ctx;

  const card = await findCardById(scope, cardId);
  if (!card) throw new CardNotFoundError();
  if (card.itemType !== "question") throw new WrongCardKindError("answer", "link");

  const question = await findQuestion(scope, card.itemId);
  if (!question) throw new CardNotFoundError();

  const settings = await loadSettings(scope);

  const graded = await gradeAnswer(ctx.ai, {
    userId: scope.userId,
    questionId: question.id,
    question: question.text,
    modelAnswer: question.modelAnswer,
    keyPoints: question.keyPoints,
    userAnswer,
    difficulty: question.difficulty,
    level: settings.requestRetention >= 0.9 ? null : null,
  });

  // A grade row only exists when there is something to store. A self-rate fallback has
  // no score, so recording one would put a fiction in the stats.
  let gradeId: string | null = null;
  if (graded.result) {
    gradeId = await saveGrade(scope, {
      questionId: question.id,
      userAnswer,
      score: graded.result.score,
      verdict: graded.result.verdict,
      result: graded.result,
      model: graded.via === "ai" ? "ai" : graded.via,
    });
  }

  log.info("graded an answer", {
    cardId,
    via: graded.via,
    score: graded.result?.score ?? null,
  });

  return {
    grade: graded.result,
    suggestedRating: graded.suggestedRating,
    suggestedRatingWord: graded.suggestedRatingWord,
    modelAnswer: graded.modelAnswer,
    gradeId,
    via: graded.via,
    ...(graded.notice ? { notice: graded.notice } : {}),
  };
}

/**
 * Reveal (PRD 8.3 FR-S-3). Hands over the model answer and nothing else. No AI call, no
 * card change: the user rates themselves next.
 */
export async function revealAnswer(
  scope: Scope,
  cardId: string,
): Promise<{ modelAnswer: string; keyPoints: string[]; suggestedRating: number }> {
  const card = await findCardById(scope, cardId);
  if (!card) throw new CardNotFoundError();
  if (card.itemType !== "question") throw new WrongCardKindError("reveal", "link");

  const question = await findQuestion(scope, card.itemId);
  if (!question) throw new CardNotFoundError();

  const fallback = selfRateFallback({ modelAnswer: question.modelAnswer });

  return {
    modelAnswer: question.modelAnswer,
    keyPoints: question.keyPoints,
    // Leaving a reveal unrated counts as Hard, so Hard is pre-selected (PRD 9.3).
    suggestedRating: fallback.suggestedRating,
  };
}

/**
 * "I don't know", the button inside the answer box (PRD 8.3 FR-S-3). Rates Again and
 * shows the answer, without spending an AI call on an answer the user did not give.
 */
export async function dontKnow(
  scope: Scope,
  cardId: string,
): Promise<{
  modelAnswer: string;
  keyPoints: string[];
  suggestedRating: number;
  suggestedRatingWord: string;
}> {
  const card = await findCardById(scope, cardId);
  if (!card) throw new CardNotFoundError();
  if (card.itemType !== "question") throw new WrongCardKindError("answer", "link");

  const question = await findQuestion(scope, card.itemId);
  if (!question) throw new CardNotFoundError();

  return {
    modelAnswer: question.modelAnswer,
    keyPoints: question.keyPoints,
    suggestedRating: 1,
    suggestedRatingWord: ratingToWord(1),
  };
}
