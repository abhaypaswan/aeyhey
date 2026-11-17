// SPDX-License-Identifier: AGPL-3.0-only
// AI contracts (PRD 13). Every AI call returns JSON validated against one of these Zod
// schemas, so a model that goes off script produces a typed failure rather than a broken
// card. The JSON Schema shapes in the PRD are the source these were written from.

import { z } from "zod";
import { CONTENT_TYPES, DIFFICULTIES, QUESTION_CATEGORIES, VERDICTS } from "../../db/types";

/**
 * Collapses whitespace and clamps to a length, rather than rejecting what is too long.
 *
 * This matters more than it looks. An earlier version piped into `.max(140)`, which
 * rejects: a real model asked for a 140 character line writes 150 now and then, the whole
 * object failed validation, the repair retry failed the same way, and the user lost the
 * summary completely over fifteen characters. Be liberal in what you accept from a model
 * and strict in what you store.
 *
 * The outer bound is generous and only catches genuine nonsense, such as a model that
 * pastes the page back.
 */
const tidy = (max: number) =>
  z
    .string()
    .max(max * 20, "That is far longer than a summary line should ever be.")
    .transform((s) => clampWords(s.replace(/\s+/g, " ").trim(), max))
    .refine((s) => s.length > 0, "This cannot be empty.");

/** Cuts at a word boundary where it can, so a clamped line does not end mid-word. */
function clampWords(text: string, max: number): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a space if it is reasonably near the end, or a long word would gut it.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,.;:]+$/, "")}...`;
}

// ---------------------------------------------------------------- 13.1 link_summary

export const LinkSummarySchema = z.object({
  /** Exactly three. Fewer or more is a contract failure, not something to paper over. */
  summary_lines: z.tuple([tidy(140), tidy(140), tidy(140)]),
  why_saved: tidy(160),
  tags: z.array(tidy(32)).min(1).max(5),
  content_type: z.enum(CONTENT_TYPES),
  read_minutes: z.number().int().min(1).max(240),
  /** ISO 639-1. */
  language: z.string().min(2).max(8),
  /** low when only the title or metadata was available. */
  confidence: z.enum(["high", "low"]),
});

export type LinkSummary = z.infer<typeof LinkSummarySchema>;

// ---------------------------------------------------------------- 13.2 resume_profile

export const ResumeProfileSchema = z.object({
  headline: tidy(200),
  years_experience: z.number().min(0).max(60).nullable(),
  skills: z
    .array(
      z.object({
        name: tidy(60),
        category: z.enum(["language", "framework", "database", "cloud", "tool", "domain", "soft"]),
      }),
    )
    .max(80),
  experiences: z
    .array(
      z.object({
        company: tidy(120),
        role: tidy(120),
        start: z.string().max(40).nullable().optional().default(null),
        end: z.string().max(40).nullable().optional().default(null),
        highlights: z.array(tidy(400)).max(12),
      }),
    )
    .max(20),
  projects: z
    .array(
      z.object({
        name: tidy(120),
        summary: tidy(600),
        tech: z.array(tidy(40)).max(20),
      }),
    )
    .max(20),
  likely_interview_areas: z.array(tidy(120)).max(20),
});

export type ResumeProfileOutput = z.infer<typeof ResumeProfileSchema>;

// ---------------------------------------------------------------- 13.3 generate_questions

export const GeneratedQuestionSchema = z.object({
  text: tidy(400),
  /** Markdown, 80 to 250 words, what a strong candidate would actually say. */
  model_answer: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(20).max(2500)),
  key_points: z.array(tidy(160)).min(2).max(6),
  tags: z.array(tidy(40)).min(1).max(4),
  category: z.enum(QUESTION_CATEGORIES),
  difficulty: z.enum(DIFFICULTIES),
  /** The resume item this refers to, or null for a general question. */
  resume_anchor: z.string().max(200).nullable().optional().default(null),
});

export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const GenerateQuestionsSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1).max(20),
});

export type GenerateQuestionsOutput = z.infer<typeof GenerateQuestionsSchema>;

// ---------------------------------------------------------------- 13.4 grade_answer

export const GradeAnswerSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(VERDICTS),
  covered_points: z.array(tidy(200)).max(10),
  missed_points: z.array(tidy(200)).max(10),
  mistakes: z.array(tidy(200)).max(10),
  /** 2 to 4 sentences, direct and kind. */
  feedback: tidy(600),
  better_answer_tip: z.string().max(300).optional(),
  /**
   * Stored for comparison but never used for scheduling: the server derives the rating
   * from `score` so intervals stay consistent across models (PRD 13.4).
   */
  suggested_rating: z.enum(["again", "hard", "good", "easy"]),
});

export type GradeAnswerOutput = z.infer<typeof GradeAnswerSchema>;

// ---------------------------------------------------------------- document_intent

/**
 * What an uploaded document is and what the person most likely wants made from it. Read
 * from the start of the document plus whatever the person typed alongside it.
 */
export const DOCUMENT_TYPES = [
  "resume",
  "book",
  "notes",
  "slides",
  "paper",
  "article",
  "syllabus",
  "job_description",
  "other",
] as const;

export const DOCUMENT_INTENTS = ["study", "resume", "topics", "unclear"] as const;

export const DocumentIntentSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  /**
   * study: questions that check they understood this material.
   * resume: interview practice on their own background.
   * topics: the document lists things to learn; questions go on each topic.
   * unclear: it could reasonably go more than one way, so the app asks.
   */
  intent: z.enum(DOCUMENT_INTENTS),
  /** A short deck name taken from the document, never a person's name. */
  title: tidy(80),
  /** One plain sentence the app can show: why it read the document this way. */
  reason: tidy(200),
  /** For intent topics: the things to learn, as short names. Empty otherwise. */
  topics: z.array(tidy(80)).max(10).default([]),
  /**
   * What the document covers and for whom, with any class, grade, exam, course or edition
   * it names: "Class 11 mathematics (CBSE)". Questions are kept inside it. Empty if unknown.
   */
  scope: z
    .string()
    .max(2_000)
    .transform((s) => clampWords(s.replace(/\s+/g, " ").trim(), 160))
    .default(""),
});

export type DocumentIntentOutput = z.infer<typeof DocumentIntentSchema>;

// ---------------------------------------------------------------- registry

// ---------------------------------------------------------------- agent_digest (PRD 29.2)

export const AgentDigestSchema = z.object({
  /** At most six: a standup for the day, not a log of it. */
  highlights: z
    .array(
      z.object({
        /** A standup note: one or two sentences on what changed and why it mattered. */
        text: tidy(280),
        kind: z.enum(["shipped", "progress", "learned"]),
        /** Which goal it came from, as the prompt named it, or null. */
        repo: z.string().max(120).nullable().optional().default(null),
      }),
    )
    .max(6),
});

export type AgentDigestOutput = z.infer<typeof AgentDigestSchema>;

export const CONTRACTS = {
  link_summary: LinkSummarySchema,
  resume_profile: ResumeProfileSchema,
  generate_questions: GenerateQuestionsSchema,
  grade_answer: GradeAnswerSchema,
  document_intent: DocumentIntentSchema,
  agent_digest: AgentDigestSchema,
} as const;

export type ContractName = keyof typeof CONTRACTS;

/** Token budget per contract, used for the gate estimate and the max output size. */
export const TOKEN_BUDGETS: Record<
  ContractName,
  { maxOutputTokens: number; timeoutMs: number; ollamaTimeoutMs: number }
> = {
  link_summary: { maxOutputTokens: 700, timeoutMs: 30_000, ollamaTimeoutMs: 90_000 },
  resume_profile: { maxOutputTokens: 3_000, timeoutMs: 60_000, ollamaTimeoutMs: 180_000 },
  generate_questions: { maxOutputTokens: 6_000, timeoutMs: 90_000, ollamaTimeoutMs: 240_000 },
  grade_answer: { maxOutputTokens: 900, timeoutMs: 30_000, ollamaTimeoutMs: 90_000 },
  document_intent: { maxOutputTokens: 600, timeoutMs: 30_000, ollamaTimeoutMs: 90_000 },
  agent_digest: { maxOutputTokens: 1_400, timeoutMs: 30_000, ollamaTimeoutMs: 90_000 },
};
