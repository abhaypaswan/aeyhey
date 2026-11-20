// SPDX-License-Identifier: AGPL-3.0-only
// AI enrichment for a link (PRD 8.1 FR-LINK-4, 13.1).
//
// Runs after extraction and produces what the card actually shows: three summary lines, a
// "why you probably saved this" sentence, tags, a content type, read minutes and a
// language.
//
// A page with no readable text is not summarized at all: a title alone is too little to
// say anything true about it.
//
// The rule that shapes this module: a link is never lost to an AI failure. If the model
// cannot produce valid output even after the one repair retry, the link gets
// ai_status = failed and still appears in sessions with its title. The user saved it; our
// summarizer having a bad day is not a reason to drop it.

import type { ContentType } from "../db/types";
import type { ExtractedContent } from "./extract/types";
import { estimateReadMinutes } from "./extract/types";
import { resolveTags } from "./tags";
import { callAi, type AiCallDeps } from "../ai/call";
import { AiContractError, AiProviderError } from "../ai/call";
import {
  buildLinkSummaryPrompt,
  LINK_SUMMARY_SYSTEM,
  MAX_PAGE_CHARS,
} from "../ai/prompts/link-summary";
import { AIBlockedError } from "../extensions/usage";
import { NoAIProviderError } from "../extensions/ai-credentials";
import { createLogger } from "../logger";

const log = createLogger("enrich");

export interface EnrichLinkInput {
  userId: string;
  linkId: string;
  url: string;
  extracted: ExtractedContent;
  userNote?: string | null;
  savedAt: Date;
  /** The user's top tags, so the model reuses them (PRD 8.1 FR-LINK-4). */
  existingTags?: string[];
  jobId?: string;
}

export interface EnrichedLink {
  aiStatus: "ok" | "failed" | "skipped";
  summaryLines: [string, string, string] | null;
  whySaved: string | null;
  summaryConfidence: "high" | "low" | null;
  tags: string[];
  contentType: ContentType;
  readMinutes: number | null;
  language: string | null;
  /** Set when enrichment did not produce a summary, for the inbox and the logs. */
  note?: string;
}

/**
 * What a link looks like with no AI at all. This is a real, supported state: a self-hoster
 * with no provider configured still gets a working inbox and working sessions, just with
 * titles instead of summaries (PRD 12.3).
 */
export function withoutAi(input: {
  extracted: ExtractedContent;
  reason: string;
  skipped?: boolean;
}): EnrichedLink {
  return {
    aiStatus: input.skipped ? "skipped" : "failed",
    summaryLines: null,
    whySaved: null,
    summaryConfidence: null,
    tags: [],
    contentType: input.extracted.contentType,
    readMinutes: estimateReadMinutes(input.extracted.text),
    language: input.extracted.language ?? null,
    note: input.reason,
  };
}

export async function enrichLink(deps: AiCallDeps, input: EnrichLinkInput): Promise<EnrichedLink> {
  const { extracted } = input;

  // No text means the page could not be read: it is private, behind a sign-in, or gone.
  // A title alone ("OpenAI Platform", "Sign in") says nothing about what the person
  // saved, so a summary written from it would be a guess. Say so instead, and spend no
  // credits on it.
  if (!extracted.text) {
    return withoutAi({
      extracted,
      reason: "This page could not be read. It may be private or need a sign-in.",
      skipped: true,
    });
  }
  const titleOnly = extracted.status !== "ok";

  const prompt = buildLinkSummaryPrompt({
    url: input.url,
    title: extracted.title ?? null,
    siteName: extracted.siteName ?? null,
    contentType: extracted.contentType,
    text: extracted.text?.slice(0, MAX_PAGE_CHARS) ?? null,
    userNote: input.userNote ?? null,
    existingTags: input.existingTags ?? [],
    savedAt: input.savedAt,
    titleOnly,
  });

  try {
    const result = await callAi(deps, {
      contract: "link_summary",
      userId: input.userId,
      system: LINK_SUMMARY_SYSTEM,
      prompt,
      ref: { type: "link", id: input.linkId },
      ...(input.jobId ? { jobId: input.jobId } : {}),
    });

    const summary = result.object;

    return {
      aiStatus: "ok",
      summaryLines: summary.summary_lines,
      whySaved: summary.why_saved,
      // The model is told to say low when it only had metadata, but extraction already
      // knows the truth, so we do not take its word for it.
      summaryConfidence: titleOnly ? "low" : summary.confidence,
      tags: resolveTags(summary.tags, input.existingTags ?? []),
      // The model sees the content and we only saw the URL, so its answer wins here.
      contentType: summary.content_type,
      readMinutes: summary.read_minutes ?? estimateReadMinutes(extracted.text),
      language: summary.language ?? extracted.language ?? null,
      ...(titleOnly ? { note: "Summary from the title only." } : {}),
    };
  } catch (error) {
    // A blocked call is not a failure. The job stays blocked and resumes when the gate
    // allows it, so this must not write ai_status = failed (PRD 23.4).
    if (error instanceof AIBlockedError) throw error;

    if (error instanceof NoAIProviderError) {
      return withoutAi({
        extracted,
        reason: "No AI provider is set up, so this link has no summary yet.",
        skipped: true,
      });
    }

    if (error instanceof AiContractError || error instanceof AiProviderError) {
      log.warn("enrichment failed, keeping the link without a summary", {
        linkId: input.linkId,
        error: error.message,
      });
      return withoutAi({ extracted, reason: error.message });
    }

    throw error;
  }
}
