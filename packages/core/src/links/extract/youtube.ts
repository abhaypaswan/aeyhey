// SPDX-License-Identifier: AGPL-3.0-only
// YouTube videos (PRD 8.1 FR-LINK-3).
//
// Title and channel come from oEmbed, which needs no key. The transcript is the valuable
// part, because a summary written from a transcript is actually about the video rather
// than about its description. Plenty of videos have no transcript, so that path has to
// degrade quietly: we summarize from the title and description and mark it partial.

import { emptyExtract, tidyText, type ExtractedContent } from "./types";
import { fetchPage, type FetchPageOptions } from "../fetch";
import { readMetadata } from "./metadata";
import { createLogger } from "../../logger";

const log = createLogger("extract:youtube");

const OEMBED_ENDPOINT = "https://www.youtube.com/oembed";

export function youTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return id && id.length >= 6 ? id : null;
    }
    if (!host.endsWith("youtube.com")) return null;

    const fromQuery = parsed.searchParams.get("v");
    if (fromQuery) return fromQuery;

    const fromPath = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(parsed.pathname)?.[1];
    return fromPath ?? null;
  } catch {
    return null;
  }
}

export function isYouTubeUrl(url: string): boolean {
  return youTubeVideoId(url) !== null;
}

interface YouTubeOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/**
 * The transcript package scrapes YouTube's own caption data, which breaks from time to
 * time when YouTube changes something. It is wrapped and optional for exactly that
 * reason: a broken transcript must never stop a link being saved.
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const mod = (await import("youtube-transcript")) as {
      YoutubeTranscript?: { fetchTranscript(id: string): Promise<{ text: string }[]> };
    };
    if (!mod.YoutubeTranscript) return null;

    const segments = await mod.YoutubeTranscript.fetchTranscript(videoId);
    if (!Array.isArray(segments) || segments.length === 0) return null;

    const text = segments
      .map((segment) => segment.text)
      .join(" ")
      // Caption text is full of these.
      .replace(/\[(?:Music|Applause|Laughter|Inaudible)\]/gi, " ")
      .replace(/&amp;#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    return text === "" ? null : text;
  } catch (error) {
    log.info("no transcript for this video", { videoId, error: (error as Error).message });
    return null;
  }
}

export async function extractYouTube(
  url: string,
  options: FetchPageOptions & { skipTranscript?: boolean } = {},
): Promise<ExtractedContent> {
  const videoId = youTubeVideoId(url);
  if (!videoId) return emptyExtract("video", "failed", "That is not a YouTube video URL.");

  const canonical = `https://www.youtube.com/watch?v=${videoId}`;

  let title: string | null = null;
  let channel: string | null = null;
  let thumbnail: string | null = null;
  let description: string | null = null;

  const endpoint = new URL(OEMBED_ENDPOINT);
  endpoint.searchParams.set("url", canonical);
  endpoint.searchParams.set("format", "json");

  try {
    const response = await fetchPage(endpoint.toString(), {
      ...options,
      headers: { accept: "application/json" },
    });
    const payload = JSON.parse(response.body) as YouTubeOEmbed;
    title = payload.title?.trim() ?? null;
    channel = payload.author_name?.trim() ?? null;
    thumbnail = payload.thumbnail_url ?? null;
  } catch (error) {
    log.info("youtube oembed failed", { videoId, error: (error as Error).message });
  }

  // The watch page carries the description in og:description, which is worth having when
  // there is no transcript.
  try {
    const page = await fetchPage(canonical, options);
    const { parseHTML } = await import("linkedom");
    const meta = readMetadata(parseHTML(page.body).document as never, canonical);
    description = meta.description;
    title = title ?? meta.title;
    thumbnail = thumbnail ?? meta.imageUrl;
  } catch (error) {
    log.info("could not read the youtube watch page", { videoId, error: (error as Error).message });
  }

  const transcript = options.skipTranscript ? null : await fetchTranscript(videoId);

  if (!title && !description && !transcript) {
    return emptyExtract(
      "video",
      "failed",
      "Nothing could be read about this video, which usually means it is private or removed.",
    );
  }

  // A transcript is real content. A description alone is not, so that is partial.
  const haveTranscript = (transcript?.length ?? 0) > 200;

  return {
    status: haveTranscript ? "ok" : "partial",
    title: title ?? "A YouTube video",
    siteName: "youtube.com",
    author: channel,
    imageUrl: thumbnail,
    contentType: "video",
    text: tidyText(haveTranscript ? transcript : description),
    finalUrl: canonical,
    ...(haveTranscript
      ? {}
      : {
          note: "This video has no transcript, so the summary comes from the title and description.",
        }),
  };
}
