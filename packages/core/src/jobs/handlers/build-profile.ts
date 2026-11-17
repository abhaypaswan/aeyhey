// SPDX-License-Identifier: AGPL-3.0-only
// build_profile: turn the resume text into structure, then queue generation
// (PRD 8.2 FR-Q-2, 13.2).

import { buildResumeProfile } from "../../questions/profile";
import { findSource, saveProfile } from "../../repos/questions";
import { scopeFor } from "../../repos/context";
import { enqueue } from "../queue";
import { BadJobPayloadError, requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:build_profile");

export async function buildProfileHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const sourceId = requireString(ctx.job.payload, "sourceId");
  const scope = scopeFor(ctx.handle, userId);

  const source = await findSource(scope, sourceId);
  if (!source) {
    log.info("source is gone, skipping", { sourceId });
    return;
  }

  if (!source.resumeText) {
    // The user deleted their resume data between upload and this job running. That is
    // their right, and there is nothing left to profile.
    throw new BadJobPayloadError(
      "That resume has no text to work from, so there is nothing to build a profile out of.",
    );
  }

  const profile = await buildResumeProfile(ctx.ai, {
    userId,
    sourceId,
    resumeText: source.resumeText,
    targetRole: source.targetRole,
    seniority: source.seniority,
    jobId: ctx.job.id,
  });

  await saveProfile(scope, sourceId, profile);

  // Generation is its own job so a slow provider cannot make the two time out together,
  // and so the user sees "Reading your resume" finish before "Writing questions" starts.
  await enqueue(ctx.handle, {
    type: "generate_questions",
    userId,
    payload: { sourceId, count: ctx.job.payload["count"] ?? 25 },
    dedupeKey: `generate:${sourceId}`,
  });
}
