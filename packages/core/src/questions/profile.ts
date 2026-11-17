// SPDX-License-Identifier: AGPL-3.0-only
// Building a structured profile from a resume (PRD 8.2 FR-Q-2, 13.2).
//
// This is a separate AI call from generation on purpose. Structure first, questions
// second, because a model asked to do both at once invents projects to ask about. With a
// profile in between, generation has concrete facts to anchor to and the prompt can say
// "name their real projects".

import type { ResumeProfile } from "../db/types";
import { callAi, type AiCallDeps } from "../ai/call";
import { buildResumeProfilePrompt, RESUME_PROFILE_SYSTEM } from "../ai/prompts/resume-profile";
import { createLogger } from "../logger";

const log = createLogger("profile");

export interface BuildProfileInput {
  userId: string;
  sourceId: string;
  resumeText: string;
  targetRole?: string | null;
  seniority?: string | null;
  jobId?: string;
}

export async function buildResumeProfile(
  deps: AiCallDeps,
  input: BuildProfileInput,
): Promise<ResumeProfile> {
  const result = await callAi(deps, {
    contract: "resume_profile",
    userId: input.userId,
    system: RESUME_PROFILE_SYSTEM,
    prompt: buildResumeProfilePrompt({
      resumeText: input.resumeText,
      targetRole: input.targetRole ?? null,
      seniority: input.seniority ?? null,
    }),
    ref: { type: "question_source", id: input.sourceId },
    ...(input.jobId ? { jobId: input.jobId } : {}),
  });

  const profile = result.object;

  log.info("built a resume profile", {
    sourceId: input.sourceId,
    skills: profile.skills.length,
    experiences: profile.experiences.length,
    projects: profile.projects.length,
  });

  // The contract allows empty sections rather than forcing the model to invent. A profile
  // with nothing concrete in it will not produce anchored questions, so say so.
  if (profile.projects.length === 0 && profile.experiences.length === 0) {
    log.warn("the profile has no projects or roles to anchor questions to", {
      sourceId: input.sourceId,
    });
  }

  return normalizeProfile(profile);
}

/** Fills the optional fields the contract leaves loose, so storage is predictable. */
export function normalizeProfile(profile: ResumeProfile): ResumeProfile {
  return {
    ...profile,
    experiences: profile.experiences.map((experience) => ({
      ...experience,
      start: experience.start ?? null,
      end: experience.end ?? null,
    })),
  };
}

/** What the review screen shows as a one-line summary of what we understood. */
export function describeProfile(profile: ResumeProfile): string {
  const bits: string[] = [];
  if (profile.years_experience !== null) bits.push(`${profile.years_experience} years`);
  if (profile.projects.length > 0) bits.push(`${profile.projects.length} projects`);
  if (profile.skills.length > 0) bits.push(`${profile.skills.length} skills`);
  if (bits.length === 0) return profile.headline;
  return `${profile.headline}. Found ${bits.join(", ")}.`;
}

/** Anchors generation can use, so the prompt can be checked against real resume items. */
export function profileAnchors(profile: ResumeProfile): string[] {
  return [
    ...profile.projects.map((project) => project.name),
    ...profile.experiences.map((experience) => experience.company),
    ...profile.skills.map((skill) => skill.name),
  ].filter((anchor) => anchor.trim().length > 0);
}
