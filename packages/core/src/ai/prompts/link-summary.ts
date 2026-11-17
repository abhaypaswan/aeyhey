// SPDX-License-Identifier: AGPL-3.0-only
// PRD 13.1 link_summary.

import type { ContentType } from "../../db/types";
import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "./shared";

export const MAX_PAGE_CHARS = 12_000;

export interface LinkSummaryInput {
  url: string;
  title?: string | null;
  siteName?: string | null;
  contentType?: ContentType | null;
  text?: string | null;
  userNote?: string | null;
  /** The user's own top tags, so the model reuses them instead of inventing synonyms. */
  existingTags?: string[];
  savedAt: Date;
  /** True when extraction failed and only metadata is available. */
  titleOnly?: boolean;
}

export const LINK_SUMMARY_SYSTEM = joinPrompt(
  "You summarize saved links for a busy person.",
  'Write exactly three short lines: what the piece is about and its most useful takeaway. Then write one sentence starting with "You probably saved this" that guesses why they saved it; use their note if there is one.',
  "Pick 3 to 5 tags that describe what the piece is about. Tags are lowercase and use hyphens between words.",
  "You will be shown the tags this person already uses. Prefer one of those when it genuinely fits, and otherwise write a new tag. The existing list is a vocabulary to draw on, not a list to choose from: a page about a subject they have never saved before should get new tags, and tagging it with something that only loosely fits is worse than adding a new tag.",
  'Set confidence to "low" when you only had the title or metadata to work from, and "high" when you had the real content.',
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

function describeAge(savedAt: Date, now = new Date()): string {
  const days = Math.round((now.getTime() - savedAt.getTime()) / 86_400_000);
  if (days <= 1) return "saved today";
  if (days < 30) return `saved ${days} days ago`;
  if (days < 365) return `saved about ${Math.round(days / 30)} months ago`;
  return `saved about ${Math.round(days / 365)} years ago`;
}

export function buildLinkSummaryPrompt(input: LinkSummaryInput): string {
  const tagList =
    input.existingTags && input.existingTags.length > 0
      ? [
          `Tags this person already uses: ${input.existingTags.slice(0, 50).join(", ")}`,
          "Use any of those that genuinely fit this page, and add new tags for whatever they do not cover.",
        ].join("\n")
      : "This person has no tags yet, so pick sensible new ones.";

  return joinPrompt(
    "Summarize this saved link.",
    `URL: ${input.url}`,
    input.title ? `Page title: ${input.title}` : null,
    input.siteName ? `Site: ${input.siteName}` : null,
    input.contentType ? `Looks like: ${input.contentType}` : null,
    `When they saved it: ${describeAge(input.savedAt)}`,
    input.userNote
      ? `Their own note about why they saved it:\n${untrusted("note", input.userNote, 500)}`
      : null,
    tagList,
    input.titleOnly
      ? 'The page content could not be fetched. Work from the URL, the title and the metadata only, and set confidence to "low".'
      : `Page content:\n${untrusted("page", input.text ?? "", MAX_PAGE_CHARS)}`,
    "Estimate read_minutes from the length of the content, at about 220 words a minute, and at least 1.",
  );
}
