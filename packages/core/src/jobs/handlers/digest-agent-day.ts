// SPDX-License-Identifier: AGPL-3.0-only
// digest_agent_day: turn one finished day of agent sessions into draft highlights.

import { digestJob } from "../../agent/digest";
import { BadJobPayloadError, requireString, type HandlerContext } from "./types";

export async function digestAgentDayHandler(ctx: HandlerContext): Promise<void> {
  const userId = ctx.job.userId;
  if (!userId) throw new BadJobPayloadError("This job needs a user.");
  const day = requireString(ctx.job.payload as Record<string, unknown>, "day");
  await digestJob(ctx.ai, ctx.handle, userId, day);
}
