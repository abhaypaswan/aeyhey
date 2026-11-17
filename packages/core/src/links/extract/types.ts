// SPDX-License-Identifier: AGPL-3.0-only
// What every extractor returns (PRD 8.1 FR-LINK-3).
//
// An extractor never throws for a page it could not read. It returns a status instead,
// because a link that failed to extract still gets a card: the user saved it, so it is
// still worth bringing back, even if all we can show is the title.

import type { ContentType, ExtractStatus } from "../../db/types";

/** Up to 20,000 characters are stored; up to 12,000 go to the AI (PRD 10, 13.1). */
export const MAX_STORED_TEXT = 20_000;

export interface ExtractedContent {
  status: ExtractStatus;
  title?: string | null;
  siteName?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  imageUrl?: string | null;
  contentType: ContentType;
  text?: string | null;
  language?: string | null;
  /** Where we actually ended up, after redirects. */
  finalUrl?: string | null;
  /** Why it is partial or failed, for the inbox and the logs. Never shown as an error. */
  note?: string | null;
}

export function emptyExtract(
  contentType: ContentType,
  status: ExtractStatus,
  note?: string,
): ExtractedContent {
  return { status, contentType, ...(note ? { note } : {}) };
}

/** Collapses whitespace and caps length, so stored text is predictable. */
export function tidyText(raw: string | null | undefined, max = MAX_STORED_TEXT): string | null {
  if (!raw) return null;
  const tidy = raw
    .replace(/\r\n?/g, "\n")
    // Keep paragraph breaks, which the AI uses to understand structure, but drop runs.
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (tidy === "") return null;
  return tidy.length > max ? `${tidy.slice(0, max).trimEnd()}...` : tidy;
}

/** About 220 words a minute, and at least a minute (PRD 13.1). */
export function estimateReadMinutes(text: string | null | undefined): number | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.min(240, Math.round(words / 220)));
}

export function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  // A date far in the future is almost always a parse artefact, not a real publish date.
  if (parsed.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) return null;
  return parsed;
}
