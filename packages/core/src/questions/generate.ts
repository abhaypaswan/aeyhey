// SPDX-License-Identifier: AGPL-3.0-only
// Generating questions (PRD 8.2 FR-Q-1, FR-Q-2, FR-Q-5, 13.3).
//
// Models get worse at this the more you ask for at once: ask for 25 questions and the
// last ten are padding. So generation loops in batches of up to 10, feeding each batch
// the questions already written so it does not repeat them, and runs dedupe at the end to
// catch the near-misses that slip through anyway.

import type { GeneratedQuestion } from "../ai/contracts/index";
import type { QuestionFocus, QuestionLevel, QuestionStyle, ResumeProfile } from "../db/types";
import { callAi, type AiCallDeps } from "../ai/call";
import {
  buildGenerateQuestionsPrompt,
  DOCUMENT_SLICE_CHARS,
  GENERATE_QUESTIONS_SYSTEM,
  MAX_QUESTIONS_PER_CALL,
} from "../ai/prompts/generate-questions";
import { dedupeQuestions } from "./dedupe";
import { profileAnchors } from "./profile";
import { AIBlockedError } from "../extensions/usage";
import { createLogger } from "../logger";

const log = createLogger("generate");

export interface GenerateQuestionsInput {
  userId: string;
  sourceId: string;
  mode: "topics" | "resume" | "document";
  topics?: string[];
  /** What the user wrote about each topic, used in every batch for that topic. */
  topicDetails?: Record<string, string>;
  /** document mode: the title and the whole stored text. Each batch gets a different slice. */
  documentTitle?: string | null;
  documentText?: string | null;
  profile?: ResumeProfile | null;
  targetRole?: string | null;
  seniority?: string | null;
  jobDescription?: string | null;
  style?: QuestionStyle;
  focus?: QuestionFocus[];
  level?: QuestionLevel | null;
  extraContext?: string | null;
  /** What the source covers and for whom. Every question stays inside it. */
  scope?: string | null;
  /** How many in total. The loop batches to reach it. */
  count: number;
  /** Questions the user already has, so nothing is repeated (PRD 13.3). */
  existingQuestions?: string[];
  jobId?: string;
}

export interface GenerateQuestionsResult {
  questions: GeneratedQuestion[];
  /** How many the model produced that were near-duplicates and got dropped. */
  duplicatesDropped: number;
  batches: number;
  /** Set when we stopped short of the count, so the UI can say so honestly. */
  shortfallReason?: string;
}

/**
 * The part of a document batch number [batch] works from. Each batch takes the next
 * slice, so a long document is covered from start to end rather than only its opening.
 * Slices overlap a little, so an idea split across a boundary is not lost.
 */
export function documentSlice(text: string | null | undefined, batch: number): string | null {
  if (!text) return null;
  if (text.length <= DOCUMENT_SLICE_CHARS) return text;
  const step = DOCUMENT_SLICE_CHARS - 1_000;
  const slices = Math.ceil((text.length - 1_000) / step);
  const start = (batch % slices) * step;
  return text.slice(start, start + DOCUMENT_SLICE_CHARS);
}

/** Stop after this many batches with nothing new, rather than looping forever. */
const MAX_EMPTY_BATCHES = 2;

export async function generateQuestions(
  deps: AiCallDeps,
  input: GenerateQuestionsInput,
): Promise<GenerateQuestionsResult> {
  const target = Math.max(1, Math.min(200, input.count));
  const existing = [...(input.existingQuestions ?? [])];

  const collected: GeneratedQuestion[] = [];
  let duplicatesDropped = 0;
  let batches = 0;
  let emptyBatches = 0;
  let shortfallReason: string | undefined;

  while (collected.length < target) {
    const remaining = target - collected.length;
    const batchSize = Math.min(remaining, MAX_QUESTIONS_PER_CALL);

    let produced: GeneratedQuestion[];
    try {
      const result = await callAi(deps, {
        contract: "generate_questions",
        userId: input.userId,
        system: GENERATE_QUESTIONS_SYSTEM,
        prompt: buildGenerateQuestionsPrompt({
          mode: input.mode,
          ...(input.topics ? { topics: input.topics } : {}),
          ...(input.topicDetails ? { topicDetails: input.topicDetails } : {}),
          documentTitle: input.documentTitle ?? null,
          documentText: documentSlice(input.documentText, batches),
          ...(input.profile ? { profile: input.profile } : {}),
          targetRole: input.targetRole ?? null,
          seniority: input.seniority ?? null,
          jobDescription: input.jobDescription ?? null,
          // A resume deck is interview prep, whatever style the source was saved with.
          style: input.mode === "resume" ? "interview" : (input.style ?? "interview"),
          ...(input.focus ? { focus: input.focus } : {}),
          count: batchSize,
          // Everything already written, so each batch moves on rather than circling.
          existingQuestions: [...existing, ...collected.map((q) => q.text)],
          extraContext: input.extraContext ?? null,
          level: input.level ?? null,
          scope: input.scope ?? null,
        }),
        ref: { type: "question_source", id: input.sourceId },
        ...(input.jobId ? { jobId: input.jobId } : {}),
      });
      produced = result.object.questions;
      batches += 1;
    } catch (error) {
      // Out of credits stops the whole loop and keeps what we have: the job is blocked
      // and resumes later (PRD 23.4).
      if (error instanceof AIBlockedError) {
        if (collected.length === 0) throw error;
        shortfallReason = error.message;
        break;
      }
      // A provider failure after some questions were written is a partial success, not a
      // total one. Keep them rather than throwing the work away.
      if (collected.length > 0) {
        log.warn("generation stopped early", { error: (error as Error).message });
        shortfallReason = "The AI provider stopped responding partway through.";
        break;
      }
      throw error;
    }

    const { kept, dropped } = dedupeQuestions(produced, [
      ...existing,
      ...collected.map((q) => q.text),
    ]);
    duplicatesDropped += dropped.length;

    if (kept.length === 0) {
      emptyBatches += 1;
      // The model has run out of distinct things to ask. Asking again wastes a call.
      if (emptyBatches >= MAX_EMPTY_BATCHES) {
        shortfallReason =
          "The AI ran out of distinct questions for this. Add another topic, or more detail, for more.";
        break;
      }
      continue;
    }

    emptyBatches = 0;
    collected.push(...kept.slice(0, remaining));
  }

  log.info("generated questions", {
    sourceId: input.sourceId,
    asked: target,
    got: collected.length,
    duplicatesDropped,
    batches,
  });

  return {
    questions: collected,
    duplicatesDropped,
    batches,
    ...(shortfallReason ? { shortfallReason } : {}),
  };
}

/**
 * How well resume mode did its job: the share of questions that name something real from
 * the resume. The PRD sets 30 percent as the acceptance bar (PRD 8.2 FR-Q-2), and this is
 * what measures it.
 */
export function anchoredShare(
  questions: readonly GeneratedQuestion[],
  profile: ResumeProfile,
): number {
  if (questions.length === 0) return 0;

  const anchors = profileAnchors(profile).map((anchor) => anchor.toLowerCase());
  if (anchors.length === 0) return 0;

  const anchored = questions.filter((question) => {
    if (question.resume_anchor) return true;
    const text = question.text.toLowerCase();
    return anchors.some((anchor) => anchor.length > 2 && text.includes(anchor));
  });

  return anchored.length / questions.length;
}

/** "More like this" on a single card (PRD 8.2 FR-Q-5). */
export async function generateMoreLikeThis(
  deps: AiCallDeps,
  input: {
    userId: string;
    sourceId: string;
    seedQuestion: { text: string; tags: string[]; category: string; difficulty: string };
    existingQuestions: string[];
    count?: number;
  },
): Promise<GenerateQuestionsResult> {
  return generateQuestions(deps, {
    userId: input.userId,
    sourceId: input.sourceId,
    mode: "topics",
    topics: input.seedQuestion.tags,
    style: "mixed",
    count: input.count ?? 3,
    existingQuestions: input.existingQuestions,
    extraContext: `Write questions in the same area as this one, at a similar difficulty: "${input.seedQuestion.text}"`,
  });
}
