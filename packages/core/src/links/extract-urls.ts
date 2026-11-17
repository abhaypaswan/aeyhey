// SPDX-License-Identifier: AGPL-3.0-only
// Finding URLs in pasted text (PRD 8.1 FR-LINK-1).
//
// People paste a mess: a newsletter, a notes file, a chat export, one URL per line with
// commentary in between. We pull every http or https URL out, normalize each one, and
// report duplicates so the Add links screen can say "45 links found, 5 already saved"
// before anything is saved.

import { normalizeUrl, type NormalizedUrl } from "./normalize";

// Deliberately permissive on the URL body and then strict in normalizeUrl, which is the
// part that actually has to be right.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\]}]+/gi;
/** A bare domain with a known-looking TLD, for text that drops the scheme. */
const BARE_DOMAIN_PATTERN =
  /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`\]}]*)?/gi;

export interface FoundUrl extends NormalizedUrl {
  /** Where it appeared, so the preview list can keep the paste order. */
  position: number;
}

export interface ExtractUrlsResult {
  /** One entry per distinct link, in the order they first appeared. */
  urls: FoundUrl[];
  /** How many times a URL repeated inside the pasted text itself. */
  duplicatesInText: number;
  /** Things that looked like a URL but were not usable. */
  skipped: string[];
}

export function extractUrls(
  text: string,
  options: { includeBareDomains?: boolean } = {},
): ExtractUrlsResult {
  const seen = new Map<string, FoundUrl>();
  const skipped: string[] = [];
  let duplicatesInText = 0;
  let position = 0;

  const consider = (raw: string): void => {
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      skipped.push(raw);
      return;
    }
    if (seen.has(normalized.normalized)) {
      duplicatesInText += 1;
      return;
    }
    seen.set(normalized.normalized, { ...normalized, position: position++ });
  };

  const matches = text.match(URL_PATTERN) ?? [];
  for (const match of matches) consider(match);

  if (options.includeBareDomains !== false) {
    // Only look at text the scheme-ful pass did not already cover, so
    // "see https://example.com/x" does not also match "example.com/x".
    const remaining = text.replace(URL_PATTERN, " ");
    for (const match of remaining.matchAll(BARE_DOMAIN_PATTERN)) {
      const candidate = `${match[1] ?? ""}${match[2] ?? ""}`;
      if (candidate.trim() === "") continue;
      consider(candidate);
    }
  }

  return { urls: [...seen.values()], duplicatesInText, skipped };
}

export function countUrls(text: string): number {
  return extractUrls(text).urls.length;
}
