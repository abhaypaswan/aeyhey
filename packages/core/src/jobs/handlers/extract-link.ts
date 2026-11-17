// SPDX-License-Identifier: AGPL-3.0-only
// extract_link: fetch the page and store what we found (PRD 8.1 FR-LINK-3).
//
// This handler never fails for a page it could not read. extractLink always returns a
// status, and the enrich job is queued either way, because even a title-only link gets a
// summary attempt and a card.

import { extractLink } from "../../links/extract/index";
import { applyExtraction, findLinkById } from "../../repos/links";
import { scopeFor } from "../../repos/context";
import { enqueue } from "../queue";
import { requireString, type HandlerContext } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("job:extract_link");

export async function extractLinkHandler(ctx: HandlerContext): Promise<void> {
  const userId = requireString({ userId: ctx.job.userId ?? "" }, "userId");
  const linkId = requireString(ctx.job.payload, "linkId");
  const scope = scopeFor(ctx.handle, userId);

  const link = await findLinkById(scope, linkId);
  if (!link) {
    // The user deleted it while the job was queued. Nothing to do, and not an error.
    log.info("link is gone, skipping", { linkId });
    return;
  }

  const extracted = await extractLink({
    url: link.url,
    options: {
      timeoutMs: ctx.env.FETCH_TIMEOUT_MS,
      allowPrivate: ctx.env.FETCH_ALLOW_PRIVATE,
    },
  });

  await applyExtraction(scope, linkId, {
    status: extracted.status,
    title: extracted.title ?? link.title,
    siteName: extracted.siteName ?? null,
    author: extracted.author ?? null,
    publishedAt: extracted.publishedAt ?? null,
    imageUrl: extracted.imageUrl ?? null,
    contentType: extracted.contentType,
    text: extracted.text ?? null,
    language: extracted.language ?? null,
  });

  log.info("extracted", { linkId, status: extracted.status, contentType: extracted.contentType });

  // Enrichment is a separate job so a slow or rate limited AI provider never holds a
  // fetch connection open, and so the two retry independently.
  await enqueue(ctx.handle, {
    type: "enrich_link",
    userId,
    payload: { linkId },
    dedupeKey: `enrich:${linkId}`,
  });
}
