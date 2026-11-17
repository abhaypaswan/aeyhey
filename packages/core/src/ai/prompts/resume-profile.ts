// SPDX-License-Identifier: AGPL-3.0-only
// PRD 13.2 resume_profile.
//
// This pass turns a resume into structure so the question writer has something concrete
// to anchor to. It deliberately does not keep contact details: the regex pass in
// questions/resume-parse.ts strips them first when strip_pii is on, and the prompt tells
// the model to leave them out either way.

import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "./shared";

export const MAX_RESUME_CHARS = 15_000;

export interface ResumeProfileInput {
  resumeText: string;
  targetRole?: string | null;
  seniority?: string | null;
}

export const RESUME_PROFILE_SYSTEM = joinPrompt(
  "You read a resume and turn it into structured facts that someone else will use to write interview questions.",
  "Only record what the resume actually says. Do not guess at achievements, numbers, companies or dates that are not there. Leave a field null or an array empty rather than inventing something.",
  "Leave out contact details: no email addresses, phone numbers, postal addresses or profile URLs.",
  "For likely_interview_areas, list the topics a real interviewer would dig into given this background and the target role.",
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

export function buildResumeProfilePrompt(input: ResumeProfileInput): string {
  return joinPrompt(
    "Turn this resume into a structured profile.",
    input.targetRole ? `They are aiming for this role: ${input.targetRole}` : null,
    input.seniority ? `At this level: ${input.seniority}` : null,
    untrusted("resume", input.resumeText, MAX_RESUME_CHARS),
  );
}
