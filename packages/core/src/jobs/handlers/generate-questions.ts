// SPDX-License-Identifier: AGPL-3.0-only
// generate_questions: write a deck's questions (PRD 8.2 FR-Q-1, FR-Q-5, 13.3).
//
// Questions are Aeyhey's to write, never the user's. They are stored kept, with a card
// each, so they go straight into sessions with no review step. The user can remove one.

import { generateQuestions } from "../../questions/generate";
import {
  createDeck,
  existingQuestionTexts,
  findDeck,
  findSource,
  saveGeneratedQuestions,
} from "../../repos/questions";
import { scopeFor, type Scope } from "../../repos/context";
import type { AiCallDeps } from "../../ai/call";
import { updateProgress } from "../queue";
import { requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:generate_questions");

function deckNameFor(source: {
  kind: string;
  topics: string[] | null;
  targetRole: string | null;
}): string {
  if (source.kind === "resume") {
    return source.targetRole ? `${source.targetRole} prep` : "From your resume";
  }
  if (source.kind === "document") return source.topics?.[0] ?? "Your document";
  const topics = source.topics ?? [];
  if (topics.length === 0) return "Questions";
  if (topics.length === 1) return topics[0]!;
  if (topics.length === 2) return `${topics[0]} and ${topics[1]}`;
  return `${topics[0]} and ${topics.length - 1} more`;
}

export async function generateQuestionsHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const sourceId = requireString(ctx.job.payload, "sourceId");
  const scope = scopeFor(ctx.handle, userId);

  const source = await findSource(scope, sourceId);
  if (!source) {
    log.info("source is gone, skipping", { sourceId });
    return;
  }

  // "Write more" passes an existing deck; a first run creates one.
  const existingDeckId = ctx.job.payload["deckId"];
  let deckId = typeof existingDeckId === "string" ? existingDeckId : null;

  if (deckId && !(await findDeck(scope, deckId))) deckId = null;

  if (!deckId) {
    const deck = await createDeck(scope, {
      name: deckNameFor(source),
      kind: source.kind === "topics" ? "topics" : source.kind,
      sourceId,
    });
    deckId = deck.id;
  }

  const topics = source.topics ?? [];
  const requested = Number(ctx.job.payload["count"] ?? 0);
  // A topic source means countPerTopic per topic; a resume source means a flat count.
  const count =
    requested > 0
      ? requested
      : source.kind === "resume"
        ? 25
        : source.kind === "document"
          ? 15
          : Math.max(1, topics.length) * source.countPerTopic;

  await updateProgress(ctx.handle, ctx.job.id, 0, count);

  const written = await writeQuestionsForDeck({
    ai: ctx.ai,
    scope,
    source,
    deckId,
    count,
    jobId: ctx.job.id,
  });
  await updateProgress(ctx.handle, ctx.job.id, written, count);
}

type Source = NonNullable<Awaited<ReturnType<typeof findSource>>>;

/**
 * What a prompt must not repeat: this deck's questions first, removed ones included, so a
 * question the user removed is never written again, then the user's other recent ones.
 */
async function textsToAvoid(scope: Scope, deckId: string): Promise<string[]> {
  const inDeck = await existingQuestionTexts(scope, { deckId, limit: 100 });
  const recent = await existingQuestionTexts(scope, { limit: 100 });
  return [...new Set([...inDeck, ...recent])].slice(0, 100);
}

/**
 * Writes `count` questions for a deck from its source and stores them kept, each with a
 * card, so they go straight into sessions. Used by the first run, "write more" and the
 * scheduled top-up alike. Returns how many were stored.
 */
export async function writeQuestionsForDeck(input: {
  ai: AiCallDeps;
  scope: Scope;
  source: Source;
  deckId: string;
  count: number;
  jobId?: string;
}): Promise<number> {
  const { scope, source, deckId, count } = input;
  const topics = source.topics ?? [];

  const result = await generateQuestions(input.ai, {
    userId: scope.userId,
    sourceId: source.id,
    mode: source.kind,
    ...(source.kind === "topics" && topics.length > 0 ? { topics } : {}),
    ...(source.kind === "topics" ? { topicDetails: source.topicDetails ?? {} } : {}),
    ...(source.kind === "document"
      ? { documentTitle: topics[0] ?? null, documentText: source.resumeText }
      : {}),
    // Topics taken from a syllabus keep the syllabus, so they stay inside it.
    ...(source.kind === "topics" && source.resumeText ? { documentText: source.resumeText } : {}),
    scope: source.scope ?? null,
    ...(source.resumeProfile ? { profile: source.resumeProfile } : {}),
    targetRole: source.targetRole,
    seniority: source.seniority,
    jobDescription: source.jobDescription,
    ...(source.style ? { style: source.style } : {}),
    ...(source.focus ? { focus: source.focus } : {}),
    level: source.level,
    extraContext: source.extraContext,
    count,
    existingQuestions: await textsToAvoid(scope, deckId),
    ...(input.jobId ? { jobId: input.jobId } : {}),
  });

  if (result.questions.length === 0) {
    log.warn("generation produced nothing", { sourceId: source.id });
    return 0;
  }

  // Kept with a card each: Aeyhey writes the questions, the user only removes one.
  await saveGeneratedQuestions(scope, { deckId, questions: result.questions, keep: true });

  log.info("questions written", {
    sourceId: source.id,
    deckId,
    count: result.questions.length,
    duplicatesDropped: result.duplicatesDropped,
  });
  return result.questions.length;
}
