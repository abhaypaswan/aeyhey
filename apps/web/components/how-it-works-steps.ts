// SPDX-License-Identifier: AGPL-3.0-only
// The three steps, in one place, because they are shown in three: the help dialog, the
// strip on Today for someone new, and the welcome screen before there is an account.

export const HOW_IT_WORKS_STEPS = [
  {
    title: "Save",
    body: "Paste the links you meant to get back to, or name the topics you want to be asked about.",
  },
  {
    title: "Aeyhey prepares the cards",
    body: "Each link gets a short summary and a guess at why you saved it. Topics, or your resume, become questions with worked answers.",
  },
  {
    title: "Review a few at a time",
    body: "A short session on the schedule you choose. What you know comes back less often, and what you miss comes back sooner.",
  },
] as const;
