// SPDX-License-Identifier: AGPL-3.0-only
// X posts (PRD 8.1 FR-LINK-3).
//
// x.com serves no useful HTML to a plain fetch: the page is a JavaScript shell and the
// post text is not in the markup. The public oEmbed endpoint gives us the text and the
// author without a key or an API tier, which is why we use it rather than scraping.
//
// When oEmbed fails, and it does for protected or deleted posts, we keep the URL and mark
// the result partial. The user still gets a card.

import { emptyExtract, tidyText, type ExtractedContent } from "./types";
import { fetchPage, type FetchPageOptions } from "../fetch";
import { createLogger } from "../../logger";

const log = createLogger("extract:x");

const OEMBED_ENDPOINT = "https://publish.twitter.com/oembed";

export function isXStatusUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return false;
    return /^\/[^/]+\/status(?:es)?\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** "\u2014 Jane Roe (@jane) March 4, 2026" and anything after it. */
const TRAILING_CREDIT = new RegExp("\\n*[\\u2013\\u2014]\\s*[\\s\\S]*$");

interface OEmbedResponse {
  html?: string;
  author_name?: string;
  author_url?: string;
  url?: string;
}

/** The oEmbed html is a blockquote. We want the words, not the markup. */
export function textFromOEmbedHtml(html: string): string | null {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const blockquote = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/i.exec(withoutScripts);
  const inner = blockquote?.[1] ?? withoutScripts;

  const text = inner
    // A <br> or the end of a <p> is a line break in the post.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    // oEmbed appends "<dash> Author (@handle) <date>" after the post, which is noise.
    // The pattern is built from escapes so this file carries no literal dash itself.
    .replace(TRAILING_CREDIT, "")
    .trim();

  return text === "" ? null : text;
}

export async function extractXPost(
  url: string,
  options: FetchPageOptions = {},
): Promise<ExtractedContent> {
  const endpoint = new URL(OEMBED_ENDPOINT);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("omit_script", "1");
  endpoint.searchParams.set("dnt", "true");
  endpoint.searchParams.set("lang", "en");

  try {
    const response = await fetchPage(endpoint.toString(), {
      ...options,
      headers: { accept: "application/json" },
    });

    const payload = JSON.parse(response.body) as OEmbedResponse;
    const text = payload.html ? textFromOEmbedHtml(payload.html) : null;
    const author = payload.author_name?.trim() ?? null;

    if (!text) {
      return {
        status: "partial",
        contentType: "thread",
        title: author ? `Post by ${author}` : "A post on X",
        siteName: "x.com",
        author,
        note: "The post text was not in the oEmbed response.",
      };
    }

    return {
      status: "ok",
      // A post has no title, so the first line stands in for one.
      title: firstLineAsTitle(text, author),
      siteName: "x.com",
      author,
      contentType: "thread",
      text: tidyText(text),
      finalUrl: payload.url ?? url,
    };
  } catch (error) {
    log.info("oembed did not return this post", { url, error: (error as Error).message });
    return emptyExtract(
      "thread",
      "partial",
      "This post could not be read, which usually means it is protected or deleted.",
    );
  }
}

function firstLineAsTitle(text: string, author: string | null): string {
  const firstLine = text.split("\n")[0]?.trim() ?? text;
  const clipped = firstLine.length > 100 ? `${firstLine.slice(0, 97).trimEnd()}...` : firstLine;
  return author ? `${author}: ${clipped}` : clipped;
}
