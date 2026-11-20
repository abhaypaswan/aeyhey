// SPDX-License-Identifier: AGPL-3.0-only
// Instagram posts and reels (PRD 8.1 FR-LINK-3).
//
// To a browser that is not signed in, instagram.com serves a JavaScript shell titled
// "Instagram" with nothing else in it. To a client that says plainly what it is, it serves
// a page whose meta tags carry the creator, the date and the caption. So this asks as
// Aeyhey, not as Chrome, and builds the card from those tags.
//
// A private account or a deleted post has no caption in the tags. That comes back partial
// with no text, and the link says it could not be read rather than guessing.

import { fetchPage, type FetchPageOptions } from "../fetch";
import { readMetadata } from "./metadata";
import { emptyExtract, parseDate, tidyText, type ExtractedContent } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("extract:instagram");

/** Says what it is. Instagram answers this with the caption; it hides it from a browser. */
export const INSTAGRAM_USER_AGENT = "Aeyhey/1.0 (+https://github.com/abhaypaswan/aeyhey)";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

export function isInstagramPostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!INSTAGRAM_HOSTS.has(parsed.hostname)) return false;
    return /^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/[\w-]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export interface InstagramCaption {
  handle: string | null;
  date: string | null;
  caption: string | null;
}

/** `handle on November 20, 2026: "the caption".` into its three parts. */
export function parseInstagramDescription(description: string | null): InstagramCaption {
  if (!description) return { handle: null, date: null, caption: null };
  const match =
    /^\s*(?:[\d,.KkMm]+ likes?, [\d,.KkMm]+ comments? - )?([\w.]+) on ([^:]+?): "([\s\S]*)"\.?\s*$/.exec(
      description,
    );
  if (!match) return { handle: null, date: null, caption: tidyText(description) };
  const caption = tidyCaption(match[3] ?? "");
  return { handle: match[1] ?? null, date: match[2]?.trim() ?? null, caption };
}

/** Drops the lone dots people use as spacers before a block of hashtags. */
function tidyCaption(raw: string): string | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^[.·•]+$/.test(line));
  return tidyText(lines.join("\n"));
}

/** "Keshav Bedi on Instagram: ..." gives "Keshav Bedi". */
function displayName(ogTitle: string | null): string | null {
  const match = ogTitle ? /^(.+?) on Instagram\b/.exec(ogTitle) : null;
  return match?.[1]?.trim() || null;
}

/** The first line of the caption, without hashtags, short enough to be a title. */
function titleFromCaption(caption: string): string | null {
  const firstLine = caption
    .split("\n")
    .map((line) => line.replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  if (firstLine.length <= 110) return firstLine;
  const cut = firstLine.slice(0, 110);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 110).trimEnd()}...`;
}

export async function extractInstagram(
  url: string,
  options: FetchPageOptions = {},
): Promise<ExtractedContent> {
  const kind = /\/(?:reels?|tv)\//.test(new URL(url).pathname) ? "reel" : "post";
  const contentType = kind === "reel" ? "video" : "other";

  let html: string;
  let finalUrl = url;
  try {
    const page = await fetchPage(url, {
      ...options,
      headers: { ...options.headers, "user-agent": INSTAGRAM_USER_AGENT },
    });
    html = page.body;
    finalUrl = page.finalUrl;
  } catch (error) {
    log.info("could not fetch the Instagram page", { url, error: (error as Error).message });
    return emptyExtract(contentType, "failed", "Instagram did not answer.");
  }

  const { parseHTML } = await import("linkedom");
  const meta = readMetadata(parseHTML(html).document as never, finalUrl);
  const { handle, date, caption } = parseInstagramDescription(meta.description);
  const name = displayName(meta.title);
  const who = name && handle ? `${name} (@${handle})` : (name ?? (handle ? `@${handle}` : null));

  if (!caption) {
    return {
      ...emptyExtract(
        contentType,
        "partial",
        "Instagram showed no caption. The account may be private.",
      ),
      title: who ? `${who} on Instagram` : null,
      siteName: "Instagram",
      author: who,
      imageUrl: meta.imageUrl,
    };
  }

  // The AI should know this is a caption on a video or photo, not the thing itself.
  const text = [
    `Instagram ${kind}${who ? ` by ${who}` : ""}${date ? `, posted ${date}` : ""}.`,
    `Caption:\n${caption}`,
  ].join("\n\n");

  return {
    // Partial: the caption is all there is to read; the video or photo is not.
    status: "partial",
    title: titleFromCaption(caption) ?? (who ? `${who} on Instagram` : null),
    siteName: "Instagram",
    author: who,
    // Instagram writes the date in UTC with no zone, so say so or it shifts by a day.
    publishedAt: date ? parseDate(`${date} UTC`) : null,
    imageUrl: meta.imageUrl,
    contentType,
    text,
    language: meta.language,
    finalUrl: meta.canonicalUrl ?? finalUrl,
    note: "Only the caption was readable.",
  };
}
