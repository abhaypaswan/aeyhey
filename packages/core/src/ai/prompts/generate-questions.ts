// SPDX-License-Identifier: AGPL-3.0-only
// PRD 13.3 generate_questions.
//
// The mix rules in resume mode are what make Aeyhey different from a generic AI question
// pack: most of the questions have to be about the user's own projects, by name.

import type { QuestionFocus, QuestionLevel, QuestionStyle, ResumeProfile } from "../../db/types";
import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "./shared";

export const MAX_JOB_DESCRIPTION_CHARS = 6_000;
/** The model writes at most this many per call; the job loops until it has enough. */
export const MAX_QUESTIONS_PER_CALL = 10;

/** How much of a document goes into one call. generate.ts moves through it in slices. */
export const DOCUMENT_SLICE_CHARS = 12_000;

export interface GenerateQuestionsInput {
  mode: "topics" | "resume" | "document";
  /** document mode: what the person called it. */
  documentTitle?: string | null;
  /** document mode: the slice of the document this call works from. */
  documentText?: string | null;
  topics?: string[];
  /** What the person wrote about a topic, keyed by its name. User text, so untrusted. */
  topicDetails?: Record<string, string>;
  profile?: ResumeProfile | null;
  targetRole?: string | null;
  seniority?: string | null;
  jobDescription?: string | null;
  style: QuestionStyle;
  focus?: QuestionFocus[];
  count: number;
  /** Texts to avoid repeating, capped at 100. */
  existingQuestions?: string[];
  extraContext?: string | null;
  level?: QuestionLevel | null;
  /**
   * What the source covers and for whom, such as "Class 11 mathematics (CBSE)". For a
   * document or a syllabus, every question has to stay inside it.
   */
  scope?: string | null;
}

/** The boundary every document-based question keeps to, said the same way each time. */
const STAY_INSIDE_EXAMPLES =
  "if it is a Class 11 book, nothing from Class 12; if it is chapter 3, nothing that a later chapter introduces";

export const GENERATE_QUESTIONS_SYSTEM = joinPrompt(
  "You write study and interview questions on any subject, each with the answer a person who really understands it would give.",
  "Rules for every question:",
  "- It must be answerable in writing in 2 to 5 minutes. Never ask someone to write a full program.",
  "- The model answer is markdown, 80 to 250 words, and reads like a good spoken answer rather than an essay.",
  "- key_points are the 2 to 6 things an answer has to contain to count as correct. A grader uses them, so make each one checkable.",
  '- Never invent an achievement, a number, a company or a project. For a behavioral question, give a STAR outline that points at the person\'s real experience and says "use a real example where you ..." when you do not know the specifics.',
  "- Set resume_anchor to the exact resume item a question is about, or null when it is a general question.",
  "- Stay inside what you are given. When the questions come from a document or a syllabus, ask only what it covers, at the level it covers it.",
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

/** The longest a topic's details can be; the API refuses anything longer. */
export const MAX_TOPIC_DETAILS_CHARS = 500;

/**
 * The person's own notes on their topics, inside a note block. Only topics in this batch
 * are included, and only ones with something written.
 */
function describeTopicDetails(
  topics: readonly string[] | undefined,
  details: Record<string, string> | undefined,
): string | null {
  if (!topics || !details) return null;
  const lines = topics
    .filter((topic) => (details[topic] ?? "").trim().length > 0)
    .map((topic) => `${topic}: ${details[topic]!.trim().slice(0, MAX_TOPIC_DETAILS_CHARS)}`);
  if (lines.length === 0) return null;
  return joinPrompt(
    "They wrote these details about some of the topics. Use them so every question and answer is accurate for what they mean by that topic:",
    untrusted("note", lines.join("\n"), lines.length * (MAX_TOPIC_DETAILS_CHARS + 120)),
  );
}

function describeMix(focus: QuestionFocus[] | undefined): string {
  const base =
    "Aim for roughly this mix: 40 percent deep dives into their real projects, 30 percent technical questions on skills they list, 20 percent questions the job description implies, 10 percent behavioral.";
  if (!focus || focus.length === 0) return base;
  return joinPrompt(
    base,
    `Shift the mix towards what they asked to focus on: ${focus.join(", ")}.`,
  );
}

function summarizeProfile(profile: ResumeProfile): string {
  const lines: string[] = [`Headline: ${profile.headline}`];
  if (profile.years_experience !== null)
    lines.push(`Years of experience: ${profile.years_experience}`);
  if (profile.skills.length > 0) {
    lines.push(`Skills: ${profile.skills.map((s) => `${s.name} (${s.category})`).join(", ")}`);
  }
  for (const experience of profile.experiences) {
    lines.push(
      `Role: ${experience.role} at ${experience.company}${experience.start ? ` from ${experience.start}` : ""}${experience.end ? ` to ${experience.end}` : ""}`,
    );
    for (const highlight of experience.highlights) lines.push(`  - ${highlight}`);
  }
  for (const project of profile.projects) {
    lines.push(`Project: ${project.name}. ${project.summary} Tech: ${project.tech.join(", ")}`);
  }
  if (profile.likely_interview_areas.length > 0) {
    lines.push(`Areas an interviewer would probe: ${profile.likely_interview_areas.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildGenerateQuestionsPrompt(input: GenerateQuestionsInput): string {
  const count = Math.min(input.count, MAX_QUESTIONS_PER_CALL);
  const styleLine =
    input.style === "interview"
      ? "Write them the way an interviewer would ask."
      : input.style === "study"
        ? "Write them as study checks, to find out whether the person really understands the idea."
        : "Mix interviewer-style questions with study checks.";

  const avoid =
    input.existingQuestions && input.existingQuestions.length > 0
      ? joinPrompt(
          "Do not repeat or lightly reword any of these questions they already have:",
          input.existingQuestions
            .slice(0, 100)
            .map((q) => `- ${q}`)
            .join("\n"),
        )
      : null;

  // The person's level changes how hard a question is. It never widens what it covers.
  const levelWithin = input.level
    ? `Pitch them for someone at ${input.level} level. That changes how hard they are, not what they cover.`
    : null;

  if (input.mode === "document") {
    return joinPrompt(
      `Write ${count} questions that check understanding of "${input.documentTitle ?? "this document"}".`,
      styleLine,
      input.scope ? `This material is: ${input.scope}.` : null,
      `Stay strictly inside the material below. Every question must be answerable from what it teaches, at the depth it teaches it. Do not ask about related ideas it does not cover, even the natural next step: ${STAY_INSIDE_EXAMPLES}.`,
      "Model answers use only the facts, methods, formulas and notation the material itself uses. Do not bring in results it has not introduced.",
      levelWithin,
      "Cover its main ideas, facts, causes and arguments, not trivia like page numbers or chapter titles.",
      "If the material is fiction or history, ask about events, people, causes and meaning. If it is science or maths, ask about concepts, how things work and how to apply them.",
      "Tag each question with the subject or theme it is about.",
      "Spread the difficulty: some easy, mostly medium, a few hard.",
      input.extraContext ? `Extra context they gave: ${input.extraContext}` : null,
      input.documentText
        ? `The material:\n${untrusted("document", input.documentText, DOCUMENT_SLICE_CHARS)}`
        : null,
      avoid,
    );
  }

  if (input.mode === "resume") {
    return joinPrompt(
      `Write ${count} interview questions for this person, based on their own background.`,
      "These are interview questions only: what an interviewer hiring for this role would really ask this person. No textbook quizzes, no definitions asked for their own sake and no trivia. A technical question belongs here only when an interviewer would ask it about a skill or project on this resume.",
      "Write them the way an interviewer would ask.",
      input.targetRole ? `Target role: ${input.targetRole}` : null,
      (input.seniority ?? input.level) ? `Level: ${input.seniority ?? input.level}` : null,
      describeMix(input.focus),
      'Name their real projects, companies and technologies in the questions where it fits, for example "In your payments service at Acme, how did you handle idempotency?".',
      input.profile ? `Their profile:\n${summarizeProfile(input.profile)}` : null,
      input.jobDescription
        ? `The job they are applying for:\n${untrusted("job_description", input.jobDescription, MAX_JOB_DESCRIPTION_CHARS)}`
        : null,
      input.extraContext ? `Extra context they gave: ${input.extraContext}` : null,
      avoid,
    );
  }

  // Topics taken from a syllabus, an outline or a job ad: the document draws the line.
  if (input.documentText || input.scope) {
    return joinPrompt(
      `Write ${count} questions about these topics: ${(input.topics ?? []).join(", ")}.`,
      styleLine,
      input.scope ? `The topics come from: ${input.scope}.` : null,
      `Keep every question inside that scope. For each topic, ask only what the outline below lists for it, at the level it sets. Do not go beyond it: ${STAY_INSIDE_EXAMPLES}; if it is a job description, only what that job needs.`,
      levelWithin,
      "Tag each question with the topic it came from.",
      "Spread the difficulty: some easy, mostly medium, a few hard.",
      input.extraContext ? `Extra context they gave: ${input.extraContext}` : null,
      describeTopicDetails(input.topics, input.topicDetails),
      input.documentText
        ? `The outline the topics come from:\n${untrusted("document", input.documentText, DOCUMENT_SLICE_CHARS)}`
        : null,
      avoid,
    );
  }

  return joinPrompt(
    `Write ${count} questions about these topics: ${(input.topics ?? []).join(", ")}.`,
    styleLine,
    input.level ? `Write them for someone at ${input.level} level.` : null,
    "Tag each question with the topic it came from.",
    "Spread the difficulty: some easy, mostly medium, a few hard.",
    input.extraContext ? `Extra context they gave: ${input.extraContext}` : null,
    describeTopicDetails(input.topics, input.topicDetails),
    avoid,
  );
}
