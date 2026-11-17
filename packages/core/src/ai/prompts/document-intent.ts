// SPDX-License-Identifier: AGPL-3.0-only
// document_intent: one short look at an uploaded document to decide what to make from it.
//
// Someone drops in a PDF and maybe types a line. Most of the time that is enough to know
// what they want: a resume means interview practice, a chapter means questions on the
// chapter, a syllabus or a job description means questions on each topic it lists. Only
// when the document could honestly go more than one way, and they did not say, does the
// app stop and ask.

import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "./shared";

/** The start of a document says what it is. Reading all of it would only cost more. */
export const DOCUMENT_INTENT_CHARS = 6_000;

export interface DocumentIntentInput {
  text: string;
  fileName?: string | null;
  /** What the person typed next to the file, in their own words. */
  request?: string | null;
}

export const DOCUMENT_INTENT_SYSTEM = joinPrompt(
  "Someone uploaded a document to a study app that writes practice questions. Look at the start of it and decide what they most likely want made from it.",
  [
    "Pick one intent:",
    "- resume: the document is a CV or resume. They want interview practice on their own experience.",
    "- study: the document is material to learn from, such as a book, a chapter, notes, slides, a paper, an article or a manual. They want questions that check they understood it.",
    "- topics: the document is a list of things to learn rather than the material itself, such as a syllabus, a course outline, an exam guide, a job description or a reading list. They want questions on each topic. Put up to 10 topics in topics, as short names.",
    "- unclear: only when the document could reasonably go more than one way and their request does not settle it. Do not use this just because you are a little unsure.",
  ].join("\n"),
  "If they wrote a request, it decides. Follow what they asked for even if the document looks like something else.",
  "For title, give a short deck name based on the document's own heading or subject. For a resume, use \"Your resume\" and never a person's name.",
  'For reason, write one short sentence saying what the document looks like, addressed to them, for example: "This looks like a course outline, so I took the topics from it."',
  "Leave topics empty unless the intent is topics.",
  'For scope, say in a few words what the document covers and who it is for, keeping any class, grade, exam, course, edition or job title it names, for example "Class 11 mathematics (CBSE), trigonometry" or "AWS Solutions Architect Associate exam". The questions will be kept inside this scope, so be exact about the level. Leave it empty if the document does not make it clear.',
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

export function buildDocumentIntentPrompt(input: DocumentIntentInput): string {
  return joinPrompt(
    "Decide what to make from this document.",
    input.fileName ? `The file is called: ${input.fileName.slice(0, 200)}` : null,
    input.request?.trim()
      ? joinPrompt("What they wrote with it:", untrusted("request", input.request, 1_000))
      : "They did not write anything with it.",
    untrusted("document", input.text, DOCUMENT_INTENT_CHARS),
  );
}
