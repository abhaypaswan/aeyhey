// SPDX-License-Identifier: AGPL-3.0-only
// Decks, question sources and questions (PRD 8.2, 10, 11).

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { newId } from "../ids";
import { withTransaction } from "../db/transaction";
import { newCard } from "../scheduler/scheduler";
import type { GeneratedQuestion } from "../ai/contracts/index";
import type {
  DeckKind,
  Difficulty,
  QuestionCategory,
  QuestionFocus,
  QuestionLevel,
  QuestionStyle,
  ResumeProfile,
  ReviewStatus,
} from "../db/types";
import type { Scope } from "./context";
import { setItemTags, tagsForItems } from "./tags";

// ---------------------------------------------------------------- sources

export interface CreateTopicSourceInput {
  topics: string[];
  level?: QuestionLevel;
  style?: QuestionStyle;
  countPerTopic?: number;
  extraContext?: string | null;
  /** What the topics belong to, when they came from a document: "Class 11 mathematics". */
  scope?: string | null;
  /**
   * The syllabus or outline the topics were taken from. Kept so each question stays
   * inside what it lists for that topic, rather than wherever the topic name leads.
   */
  referenceText?: string | null;
}

export async function createTopicSource(
  scope: Scope,
  input: CreateTopicSourceInput,
): Promise<string> {
  const { questionSources } = scope.handle.schema;
  const id = newId();

  await scope.handle.db.insert(questionSources).values({
    id,
    userId: scope.userId,
    kind: "topics",
    topics: input.topics,
    level: input.level ?? "mid",
    style: input.style ?? "interview",
    countPerTopic: input.countPerTopic ?? 5,
    extraContext: input.extraContext ?? null,
    scope: input.scope?.trim() || null,
    // The same column a document's text lives in.
    resumeText: input.referenceText ?? null,
    createdAt: new Date(),
  });

  return id;
}

export interface CreateResumeSourceInput {
  resumeText: string;
  resumeFilePath?: string | null;
  targetRole?: string | null;
  seniority?: string | null;
  jobDescription?: string | null;
  focus?: QuestionFocus[];
}

export async function createResumeSource(
  scope: Scope,
  input: CreateResumeSourceInput,
): Promise<string> {
  const { questionSources } = scope.handle.schema;
  const id = newId();

  await scope.handle.db.insert(questionSources).values({
    id,
    userId: scope.userId,
    kind: "resume",
    resumeText: input.resumeText,
    // Only set when the user ticked "keep my resume file" (PRD 8.2 FR-Q-7).
    resumeFilePath: input.resumeFilePath ?? null,
    targetRole: input.targetRole ?? null,
    seniority: input.seniority ?? null,
    jobDescription: input.jobDescription ?? null,
    focus: input.focus ?? ["projects", "skills"],
    createdAt: new Date(),
  });

  return id;
}

export interface CreateDocumentSourceInput {
  /** What the person calls it, such as "Sapiens" or "Physics chapter 4". */
  title: string;
  /** The text read from the file or pasted. Kept so "write more" can come back to it. */
  text: string;
  level?: QuestionLevel | null;
  style?: QuestionStyle | null;
  extraContext?: string | null;
  /** What the document covers and for whom. Questions stay inside it. */
  scope?: string | null;
}

/**
 * A document to study from: any subject, any kind of text. The text lives in the same
 * column a resume does, and the title in topics, which is what names the deck and labels
 * its cards.
 */
export async function createDocumentSource(
  scope: Scope,
  input: CreateDocumentSourceInput,
): Promise<string> {
  const { questionSources } = scope.handle.schema;
  const id = newId();

  await scope.handle.db.insert(questionSources).values({
    id,
    userId: scope.userId,
    kind: "document",
    topics: [input.title],
    resumeText: input.text,
    level: input.level ?? null,
    style: input.style ?? "study",
    extraContext: input.extraContext ?? null,
    scope: input.scope?.trim() || null,
    createdAt: new Date(),
  });

  return id;
}

export async function findSource(scope: Scope, sourceId: string) {
  const { questionSources } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(questionSources)
    .where(and(eq(questionSources.userId, scope.userId), eq(questionSources.id, sourceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveProfile(
  scope: Scope,
  sourceId: string,
  profile: ResumeProfile,
): Promise<void> {
  const { questionSources } = scope.handle.schema;
  await scope.handle.db
    .update(questionSources)
    .set({ resumeProfile: profile })
    .where(and(eq(questionSources.userId, scope.userId), eq(questionSources.id, sourceId)));
}

/**
 * Deletes the resume text, file path and profile, keeping the questions (PRD 8.2 FR-Q-7).
 * The user can do this at any time, and it must not cost them the deck they generated.
 */
export async function deleteResumeData(
  scope: Scope,
  sourceId: string,
): Promise<{ filePath: string | null }> {
  const { questionSources } = scope.handle.schema;

  const source = await findSource(scope, sourceId);
  if (!source) return { filePath: null };

  await scope.handle.db
    .update(questionSources)
    .set({ resumeText: null, resumeFilePath: null, resumeProfile: null, jobDescription: null })
    .where(and(eq(questionSources.userId, scope.userId), eq(questionSources.id, sourceId)));

  // Returned so the caller can delete the file off disk too.
  return { filePath: source.resumeFilePath };
}

// ---------------------------------------------------------------- decks

export interface DeckRow {
  id: string;
  name: string;
  kind: DeckKind;
  sourceId: string | null;
  /** When the user paused the deck, or null while its questions are being asked. */
  pausedAt: Date | null;
  createdAt: Date;
}

export async function createDeck(
  scope: Scope,
  input: { name: string; kind: DeckKind; sourceId?: string | null },
): Promise<DeckRow> {
  const { decks } = scope.handle.schema;
  const row = {
    id: newId(),
    userId: scope.userId,
    name: input.name,
    kind: input.kind,
    sourceId: input.sourceId ?? null,
    pausedAt: null,
    createdAt: new Date(),
  };
  await scope.handle.db.insert(decks).values(row);
  return row;
}

/**
 * A question counts as learned once the scheduler trusts it for three weeks at a time, the
 * line Anki draws for a "mature" card. Answered once is not learned: a card answered
 * yesterday can be due again today, and calling it learned made "4 due, 4 learned" out
 * of 7 look like a contradiction.
 */
export const LEARNED_INTERVAL_DAYS = 21;

export interface DeckWithCounts extends DeckRow {
  counts: {
    total: number;
    new: number;
    /** dueNew + dueReview. */
    due: number;
    /** Never asked yet, and ready to be. */
    dueNew: number;
    /** Asked before and come round again. */
    dueReview: number;
    learned: number;
    suspended: number;
  };
}

export async function listDecks(scope: Scope, now = new Date()): Promise<DeckWithCounts[]> {
  const { decks, questions, cards } = scope.handle.schema;

  const deckRows = await scope.handle.db
    .select()
    .from(decks)
    .where(eq(decks.userId, scope.userId))
    .orderBy(asc(decks.createdAt));

  if (deckRows.length === 0) return [];

  // Two grouped queries rather than one with a CASE over the due date. A Date cannot be
  // interpolated into a raw sql template: better-sqlite3 only binds numbers, strings,
  // bigints, buffers and null, and the dialects store a timestamp differently anyway.
  // Going through lte() lets drizzle map the value for whichever dialect is in play.
  const totals = await scope.handle.db
    .select({
      deckId: questions.deckId,
      status: cards.status,
      total: sql<number>`count(*)`.as("total"),
    })
    .from(questions)
    .innerJoin(cards, and(eq(cards.itemType, "question"), eq(cards.itemId, questions.id)))
    .where(and(eq(questions.userId, scope.userId), eq(questions.reviewStatus, "kept")))
    .groupBy(questions.deckId, cards.status);

  const dueRows = await scope.handle.db
    .select({
      deckId: questions.deckId,
      status: cards.status,
      due: sql<number>`count(*)`.as("due"),
    })
    .from(questions)
    .innerJoin(cards, and(eq(cards.itemType, "question"), eq(cards.itemId, questions.id)))
    .where(
      and(
        eq(questions.userId, scope.userId),
        eq(questions.reviewStatus, "kept"),
        inArray(cards.status, ["new", "active"]),
        lte(cards.due, now),
      ),
    )
    .groupBy(questions.deckId, cards.status);

  const learnedRows = await scope.handle.db
    .select({
      deckId: questions.deckId,
      learned: sql<number>`count(*)`.as("learned"),
    })
    .from(questions)
    .innerJoin(cards, and(eq(cards.itemType, "question"), eq(cards.itemId, questions.id)))
    .where(
      and(
        eq(questions.userId, scope.userId),
        eq(questions.reviewStatus, "kept"),
        eq(cards.status, "active"),
        gte(cards.scheduledDays, LEARNED_INTERVAL_DAYS),
      ),
    )
    .groupBy(questions.deckId);

  const dueOf = (deckId: string, status: string): number =>
    dueRows
      .filter((row) => row.deckId === deckId && row.status === status)
      .reduce((sum, row) => sum + Number(row.due), 0);
  const learnedByDeck = new Map(learnedRows.map((row) => [row.deckId, Number(row.learned)]));

  return deckRows.map((deck) => {
    const rows = totals.filter((row) => row.deckId === deck.id);
    const sumWhere = (predicate: (status: string) => boolean): number =>
      rows.filter((row) => predicate(row.status)).reduce((sum, row) => sum + Number(row.total), 0);

    const total = sumWhere(() => true);
    const fresh = sumWhere((status) => status === "new");
    const suspended = sumWhere((status) => status === "suspended");

    const dueNew = dueOf(deck.id, "new");
    const dueReview = dueOf(deck.id, "active");
    return {
      id: deck.id,
      name: deck.name,
      kind: deck.kind,
      sourceId: deck.sourceId,
      pausedAt: deck.pausedAt,
      createdAt: deck.createdAt,
      counts: {
        total,
        new: fresh,
        due: dueNew + dueReview,
        dueNew,
        dueReview,
        learned: learnedByDeck.get(deck.id) ?? 0,
        suspended,
      },
    };
  });
}

export async function findDeck(scope: Scope, deckId: string): Promise<DeckRow | null> {
  const { decks } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(decks)
    .where(and(eq(decks.userId, scope.userId), eq(decks.id, deckId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function renameDeck(scope: Scope, deckId: string, name: string): Promise<void> {
  const { decks } = scope.handle.schema;
  await scope.handle.db
    .update(decks)
    .set({ name })
    .where(and(eq(decks.userId, scope.userId), eq(decks.id, deckId)));
}

/**
 * Pauses a deck or resumes it. Nothing about its questions changes: while paused they are
 * left out of reviews and no new ones are written, and resuming picks up where it stopped.
 */
export async function setDeckPaused(scope: Scope, deckId: string, paused: boolean): Promise<void> {
  const { decks } = scope.handle.schema;
  await scope.handle.db
    .update(decks)
    .set({ pausedAt: paused ? new Date() : null })
    .where(and(eq(decks.userId, scope.userId), eq(decks.id, deckId)));
}

/** Deletes a deck, its questions and their cards together. */
export async function deleteDeck(scope: Scope, deckId: string): Promise<void> {
  const { decks, questions, cards, itemTags } = scope.handle.schema;

  const questionRows = await scope.handle.db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.userId, scope.userId), eq(questions.deckId, deckId)));
  const ids = questionRows.map((row) => row.id);

  await withTransaction(scope.handle, async (tx) => {
    if (ids.length > 0) {
      await tx.delete(cards).where(and(eq(cards.itemType, "question"), inArray(cards.itemId, ids)));
      await tx
        .delete(itemTags)
        .where(and(eq(itemTags.itemType, "question"), inArray(itemTags.itemId, ids)));
      await tx.delete(questions).where(inArray(questions.id, ids));
    }
    await tx.delete(decks).where(and(eq(decks.userId, scope.userId), eq(decks.id, deckId)));
  });
}

// ---------------------------------------------------------------- questions

export interface QuestionRow {
  id: string;
  deckId: string;
  position: number;
  text: string;
  modelAnswer: string;
  keyPoints: string[];
  category: QuestionCategory;
  difficulty: Difficulty;
  resumeAnchor: string | null;
  reviewStatus: ReviewStatus;
  tags: string[];
}

/**
 * Stores generated questions. With `keep`, which is what the generation job does, they
 * go straight in as kept with a card each, ready for the next session: Aeyhey writes the
 * questions and the user only ever removes one. Without it they wait as pending_review
 * with no card, the old review step (PRD 8.2 FR-Q-3), kept for callers that still want it.
 */
export async function saveGeneratedQuestions(
  scope: Scope,
  input: { deckId: string; questions: readonly GeneratedQuestion[]; keep?: boolean },
): Promise<string[]> {
  const { questions } = scope.handle.schema;
  if (input.questions.length === 0) return [];

  const existing = await scope.handle.db
    .select({ position: questions.position })
    .from(questions)
    .where(and(eq(questions.userId, scope.userId), eq(questions.deckId, input.deckId)))
    .orderBy(desc(questions.position))
    .limit(1);
  const startAt = (existing[0]?.position ?? -1) + 1;

  const now = new Date();
  const rows = input.questions.map((question, index) => ({
    id: newId(now),
    userId: scope.userId,
    deckId: input.deckId,
    position: startAt + index,
    text: question.text,
    modelAnswer: question.model_answer,
    keyPoints: question.key_points,
    category: question.category,
    difficulty: question.difficulty,
    resumeAnchor: question.resume_anchor ?? null,
    origin: "ai" as const,
    reviewStatus: "pending_review" as ReviewStatus,
    createdAt: now,
    updatedAt: now,
  }));

  await scope.handle.db.insert(questions).values(rows);

  // Tags are attached now so the review list can show them.
  for (const [index, row] of rows.entries()) {
    const tags = input.questions[index]?.tags ?? [];
    if (tags.length > 0) {
      await setItemTags(scope, { type: "question", id: row.id }, tags);
    }
  }

  const ids = rows.map((row) => row.id);
  if (input.keep) await acceptQuestions(scope, { keepIds: ids });
  return ids;
}

/** Where a question stands in spaced repetition, for showing and filtering a deck. */
export type QuestionProgressState = "new" | "due" | "learning" | "learned";

export interface QuestionProgress {
  /**
   * new: never asked. due: asked before and come round again. learning: asked, next
   * review under three weeks away. learned: spaced LEARNED_INTERVAL_DAYS or more apart.
   */
  state: QuestionProgressState;
  /** How many times it has been asked and answered. */
  timesAsked: number;
  /** When it was last asked, or null if never. */
  lastAskedAt: Date | null;
}

/** Progress for each question that has an active or new card. Suspended ones are left out. */
export async function questionProgress(
  scope: Scope,
  questionIds: string[],
  now = new Date(),
): Promise<Map<string, QuestionProgress>> {
  const { cards } = scope.handle.schema;
  const result = new Map<string, QuestionProgress>();
  if (questionIds.length === 0) return result;

  const rows = await scope.handle.db
    .select({
      itemId: cards.itemId,
      status: cards.status,
      due: cards.due,
      scheduledDays: cards.scheduledDays,
      reps: cards.reps,
      lastReview: cards.lastReview,
    })
    .from(cards)
    .where(
      and(
        eq(cards.userId, scope.userId),
        eq(cards.itemType, "question"),
        inArray(cards.itemId, questionIds),
        inArray(cards.status, ["new", "active"]),
      ),
    );

  for (const row of rows) {
    const state: QuestionProgressState =
      row.status === "new"
        ? "new"
        : row.due.getTime() <= now.getTime()
          ? "due"
          : row.scheduledDays >= LEARNED_INTERVAL_DAYS
            ? "learned"
            : "learning";
    result.set(row.itemId, { state, timesAsked: row.reps, lastAskedAt: row.lastReview ?? null });
  }
  return result;
}

export async function listQuestions(
  scope: Scope,
  filters: { deckId?: string; reviewStatus?: ReviewStatus; difficulty?: Difficulty },
): Promise<QuestionRow[]> {
  const { questions } = scope.handle.schema;

  const conditions = [eq(questions.userId, scope.userId)];
  if (filters.deckId) conditions.push(eq(questions.deckId, filters.deckId));
  if (filters.reviewStatus) conditions.push(eq(questions.reviewStatus, filters.reviewStatus));
  if (filters.difficulty) conditions.push(eq(questions.difficulty, filters.difficulty));

  const rows = await scope.handle.db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(asc(questions.position));

  const tagMap = await tagsForItems(
    scope,
    "question",
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    deckId: row.deckId,
    position: row.position,
    text: row.text,
    modelAnswer: row.modelAnswer,
    keyPoints: row.keyPoints,
    category: row.category,
    difficulty: row.difficulty,
    resumeAnchor: row.resumeAnchor,
    reviewStatus: row.reviewStatus,
    tags: tagMap.get(row.id) ?? [],
  }));
}

export async function findQuestion(scope: Scope, questionId: string) {
  const { questions } = scope.handle.schema;
  const rows = await scope.handle.db
    .select()
    .from(questions)
    .where(and(eq(questions.userId, scope.userId), eq(questions.id, questionId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface AcceptQuestionsInput {
  keepIds: string[];
  removeIds?: string[];
  edits?: { id: string; text?: string; modelAnswer?: string; tags?: string[] }[];
}

/**
 * The review step (PRD 8.2 FR-Q-3). Kept questions get a card, removed ones get none, and
 * edits are saved. This is where a question becomes schedulable.
 */
export async function acceptQuestions(
  scope: Scope,
  input: AcceptQuestionsInput,
): Promise<{ kept: number; removed: number }> {
  const { questions, cards } = scope.handle.schema;
  const now = new Date();

  for (const edit of input.edits ?? []) {
    await scope.handle.db
      .update(questions)
      .set({
        ...(edit.text !== undefined ? { text: edit.text } : {}),
        ...(edit.modelAnswer !== undefined ? { modelAnswer: edit.modelAnswer } : {}),
        updatedAt: now,
      })
      .where(and(eq(questions.userId, scope.userId), eq(questions.id, edit.id)));

    if (edit.tags) {
      await setItemTags(scope, { type: "question", id: edit.id }, edit.tags);
    }
  }

  if (input.removeIds && input.removeIds.length > 0) {
    await scope.handle.db
      .update(questions)
      .set({ reviewStatus: "removed", updatedAt: now })
      .where(and(eq(questions.userId, scope.userId), inArray(questions.id, input.removeIds)));
  }

  if (input.keepIds.length === 0) return { kept: 0, removed: input.removeIds?.length ?? 0 };

  // Only create a card for a question that does not already have one, so accepting twice
  // is safe.
  const withCards = await scope.handle.db
    .select({ itemId: cards.itemId })
    .from(cards)
    .where(and(eq(cards.itemType, "question"), inArray(cards.itemId, input.keepIds)));
  const alreadyCarded = new Set(withCards.map((row) => row.itemId));
  const needCards = input.keepIds.filter((id) => !alreadyCarded.has(id));

  await withTransaction(scope.handle, async (tx) => {
    await tx
      .update(questions)
      .set({ reviewStatus: "kept", updatedAt: now })
      .where(and(eq(questions.userId, scope.userId), inArray(questions.id, input.keepIds)));

    if (needCards.length > 0) {
      await tx.insert(cards).values(
        needCards.map((questionId) => {
          const card = newCard({ id: newId(now), status: "new", now });
          return {
            id: card.id,
            userId: scope.userId,
            itemType: "question" as const,
            itemId: questionId,
            status: card.status,
            due: card.due,
            stability: card.stability,
            difficulty: card.difficulty,
            scheduledDays: card.scheduledDays,
            reps: card.reps,
            lapses: card.lapses,
            learningSteps: card.learningSteps,
            fsrsState: card.fsrsState,
            lastReview: card.lastReview,
            skipCount: card.skipCount,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }
  });

  return { kept: input.keepIds.length, removed: input.removeIds?.length ?? 0 };
}

export interface ManualQuestionInput {
  deckId: string;
  text: string;
  modelAnswer: string;
  keyPoints?: string[];
  category?: QuestionCategory;
  difficulty?: Difficulty;
  tags?: string[];
}

/** A question the user wrote themselves. Kept and carded immediately (PRD 8.2 FR-Q-6). */
export async function addManualQuestion(scope: Scope, input: ManualQuestionInput): Promise<string> {
  const { questions } = scope.handle.schema;
  const now = new Date();
  const id = newId(now);

  const existing = await scope.handle.db
    .select({ position: questions.position })
    .from(questions)
    .where(and(eq(questions.userId, scope.userId), eq(questions.deckId, input.deckId)))
    .orderBy(desc(questions.position))
    .limit(1);

  await scope.handle.db.insert(questions).values({
    id,
    userId: scope.userId,
    deckId: input.deckId,
    position: (existing[0]?.position ?? -1) + 1,
    text: input.text,
    modelAnswer: input.modelAnswer,
    keyPoints: input.keyPoints ?? [],
    category: input.category ?? "technical",
    difficulty: input.difficulty ?? "medium",
    origin: "manual",
    reviewStatus: "kept",
    createdAt: now,
    updatedAt: now,
  });

  if (input.tags && input.tags.length > 0) {
    await setItemTags(scope, { type: "question", id }, input.tags);
  }

  await acceptQuestions(scope, { keepIds: [id] });
  return id;
}

export async function updateQuestion(
  scope: Scope,
  questionId: string,
  patch: { text?: string; modelAnswer?: string; keyPoints?: string[]; difficulty?: Difficulty },
): Promise<void> {
  const { questions } = scope.handle.schema;
  await scope.handle.db
    .update(questions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(questions.userId, scope.userId), eq(questions.id, questionId)));
}

/**
 * Removes a question for good. Its card and tags go, so it is never asked again, but the
 * row stays as "removed": its text is what keeps later batches from writing it again
 * (see existingQuestionTexts). Only the owner's question is touched.
 */
export async function deleteQuestion(scope: Scope, questionId: string): Promise<void> {
  const { questions, cards, itemTags } = scope.handle.schema;

  const owned = await findQuestion(scope, questionId);
  if (!owned) return;

  await withTransaction(scope.handle, async (tx) => {
    await tx.delete(cards).where(and(eq(cards.itemType, "question"), eq(cards.itemId, questionId)));
    await tx
      .delete(itemTags)
      .where(and(eq(itemTags.itemType, "question"), eq(itemTags.itemId, questionId)));
    await tx
      .update(questions)
      .set({ reviewStatus: "removed", updatedAt: new Date() })
      .where(and(eq(questions.userId, scope.userId), eq(questions.id, questionId)));
  });
}

/** Unseen question cards per deck: kept questions whose card is still new. */
export async function unseenQuestionsByDeck(scope: Scope): Promise<Map<string, number>> {
  const { questions, cards } = scope.handle.schema;
  const rows = await scope.handle.db
    .select({ deckId: questions.deckId, unseen: sql<number>`count(*)`.as("unseen") })
    .from(questions)
    .innerJoin(cards, and(eq(cards.itemType, "question"), eq(cards.itemId, questions.id)))
    .where(
      and(
        eq(questions.userId, scope.userId),
        eq(questions.reviewStatus, "kept"),
        eq(cards.status, "new"),
      ),
    )
    .groupBy(questions.deckId);
  return new Map(rows.map((row) => [row.deckId, Number(row.unseen)]));
}

export interface DeckTopic {
  name: string;
  /** What the user wrote about this topic, or null when nothing. */
  details: string | null;
}

/**
 * The topics a deck is written from, each with the user's details. Only a topics deck
 * has any: resume, document, manual and links decks get an empty list.
 */
export async function deckTopics(
  scope: Scope,
  deck: Pick<DeckRow, "kind" | "sourceId">,
): Promise<{ sourceId: string | null; topics: DeckTopic[]; details: Record<string, string> }> {
  if (deck.kind !== "topics" || !deck.sourceId) {
    return { sourceId: null, topics: [], details: {} };
  }
  const source = await findSource(scope, deck.sourceId);
  if (!source || source.kind !== "topics") return { sourceId: null, topics: [], details: {} };
  const details = source.topicDetails ?? {};
  return {
    sourceId: source.id,
    topics: (source.topics ?? []).map((name) => ({ name, details: details[name] ?? null })),
    details,
  };
}

/** Replaces a source's topic details. Callers validate the names and lengths. */
export async function setTopicDetails(
  scope: Scope,
  sourceId: string,
  details: Record<string, string>,
): Promise<void> {
  const { questionSources } = scope.handle.schema;
  await scope.handle.db
    .update(questionSources)
    .set({ topicDetails: details })
    .where(and(eq(questionSources.userId, scope.userId), eq(questionSources.id, sourceId)));
}

/** The texts a generation prompt must avoid repeating (PRD 13.3). */
export async function existingQuestionTexts(
  scope: Scope,
  options: { deckId?: string; limit?: number } = {},
): Promise<string[]> {
  const { questions } = scope.handle.schema;

  const conditions = [eq(questions.userId, scope.userId)];
  if (options.deckId) conditions.push(eq(questions.deckId, options.deckId));

  const rows = await scope.handle.db
    .select({ text: questions.text })
    .from(questions)
    .where(and(...conditions))
    .orderBy(desc(questions.createdAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => row.text);
}

export interface LastAnswer {
  text: string;
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  answeredAt: Date;
}

/**
 * The user's latest written answer to each question, as graded. Only answers whose review
 * still stands count: an undone review takes its answer with it. Questions never answered
 * in writing are left out of the map.
 */
export async function lastAnswers(
  scope: Scope,
  questionIds: string[],
): Promise<Map<string, LastAnswer>> {
  const { grades, reviewLogs } = scope.handle.schema;
  const result = new Map<string, LastAnswer>();
  if (questionIds.length === 0) return result;

  const rows = await scope.handle.db
    .select({
      questionId: grades.questionId,
      text: grades.userAnswer,
      verdict: grades.verdict,
      score: grades.score,
      answeredAt: grades.createdAt,
    })
    .from(grades)
    .innerJoin(reviewLogs, eq(reviewLogs.gradeId, grades.id))
    .where(
      and(
        eq(grades.userId, scope.userId),
        eq(reviewLogs.userId, scope.userId),
        eq(reviewLogs.undone, false),
        inArray(grades.questionId, questionIds),
      ),
    )
    .orderBy(desc(grades.createdAt));

  for (const row of rows) {
    if (!result.has(row.questionId)) result.set(row.questionId, row);
  }
  return result;
}

/** Stores a grade and links it to the review (PRD 10 grades). */
export async function saveGrade(
  scope: Scope,
  input: {
    questionId: string;
    userAnswer: string;
    score: number;
    verdict: "correct" | "partial" | "incorrect";
    result: unknown;
    model: string;
  },
): Promise<string> {
  const { grades } = scope.handle.schema;
  const id = newId();

  await scope.handle.db.insert(grades).values({
    id,
    userId: scope.userId,
    questionId: input.questionId,
    userAnswer: input.userAnswer,
    score: input.score,
    verdict: input.verdict,
    result: input.result as never,
    model: input.model,
    createdAt: new Date(),
  });

  return id;
}
