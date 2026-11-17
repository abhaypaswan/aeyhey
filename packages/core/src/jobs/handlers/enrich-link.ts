// SPDX-License-Identifier: AGPL-3.0-only
// enrich_link: write the summary, the why, and the tags (PRD 8.1 FR-LINK-4).

import { enrichLink } from "../../links/enrich";
import { applyEnrichment, findLinkById } from "../../repos/links";
import { setItemTags, topTags } from "../../repos/tags";
import { scopeFor } from "../../repos/context";
import { requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:enrich_link");

export async function enrichLinkHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const linkId = requireString(ctx.job.payload, "linkId");
  const scope = scopeFor(ctx.handle, userId);

  const link = await findLinkById(scope, linkId);
  if (!link) {
    log.info("link is gone, skipping", { linkId });
    return;
  }

  const existingTags = await topTags(scope, 50);

  // An AIBlockedError thrown here propagates on purpose: the worker turns it into a
  // blocked job rather than a failed one (PRD 23.4).
  const enriched = await enrichLink(ctx.ai, {
    userId,
    linkId,
    url: link.url,
    extracted: {
      status: link.extractStatus,
      title: link.title,
      siteName: link.siteName,
      contentType: link.contentType,
      text: link.extractedText,
      language: link.language,
    },
    userNote: link.userNote,
    savedAt: link.savedAt,
    existingTags,
    jobId: ctx.job.id,
  });

  await applyEnrichment(scope, linkId, {
    aiStatus: enriched.aiStatus,
    summaryLines: enriched.summaryLines,
    whySaved: enriched.whySaved,
    summaryConfidence: enriched.summaryConfidence,
    contentType: enriched.contentType,
    readMinutes: enriched.readMinutes,
    language: enriched.language,
  });

  if (enriched.tags.length > 0) {
    await setItemTags(scope, { type: "link", id: linkId }, enriched.tags);
  }

  log.info("enriched", { linkId, aiStatus: enriched.aiStatus, tags: enriched.tags.length });
}
