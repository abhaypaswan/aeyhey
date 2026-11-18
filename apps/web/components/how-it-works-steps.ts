// SPDX-License-Identifier: AGPL-3.0-only
// The three steps, in one place, because they are shown in two: the help dialog and the
// welcome screen before there is an account.
//
// Links were where Aeyhey started, but they are one of several things it keeps: topics,
// a book or notes, a syllabus and a resume all become questions. The steps say so.

export const HOW_IT_WORKS_STEPS = [
  {
    title: "Add anything",
    body: "Save the links you meant to read. Name a topic, or upload a book, your notes, a syllabus or your resume.",
  },
  {
    title: "Aeyhey prepares the cards",
    body: "Each link gets a short summary. Everything else becomes questions with worked answers, at the level you choose.",
  },
  {
    title: "Review a few at a time",
    body: "A short session on the schedule you choose. What you know comes back less often, what you miss comes back sooner, until you have it.",
  },
] as const;
