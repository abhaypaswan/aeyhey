// SPDX-License-Identifier: AGPL-3.0-only
// The generic page extractor: articles, blog posts, docs, anything HTML.
//
// Readability does the hard part, which is deciding what on the page is the article and
// what is navigation, a cookie banner or a related-posts rail. When it finds nothing,
// we fall back to the metadata and mark the result partial, because a card with a title
// and an og:description is still worth showing.

import type { parseHTML } from "linkedom";
import type { ContentType } from "../../db/types";
import { readMetadata } from "./metadata";
import { emptyExtract, tidyText, type ExtractedContent } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("extract:generic");

/**
 * The text of the whole document, used when the parsed body turns out to be empty.
 * Strips the tags that are never content before reading, so a script or a nav does not
 * end up in the summary.
 */
function safelyReadText(document: ParsedDocument): string | null {
  try {
    for (const selector of ["script", "style", "noscript", "nav", "footer", "header"]) {
      for (const node of document.querySelectorAll(selector)) node.remove();
    }
    return tidyText(document.documentElement?.textContent ?? null);
  } catch {
    return null;
  }
}

/**
 * linkedom's document. Named here rather than written as an inline import() annotation,
 * which the lint config forbids, and which reads badly in the middle of a function.
 */
type ParsedDocument = ReturnType<typeof parseHTML>["document"];

/** Below this many characters, Readability's answer is usually navigation chrome. */
const MIN_ARTICLE_CHARS = 200;

/**
 * Guessing the content type from the URL, the og:type and the shape of the page. This
 * only sets a default: the AI gets the final say in link_summary (PRD 13.1).
 */
export function guessContentType(input: {
  url: string;
  ogType?: string | null;
  textLength?: number;
}): ContentType {
  const url = input.url.toLowerCase();
  const ogType = input.ogType?.toLowerCase() ?? "";

  if (ogType.includes("video") || /youtube\.com|vimeo\.com|youtu\.be/.test(url)) return "video";
  if (/x\.com|twitter\.com|bsky\.app|mastodon/.test(url)) return "thread";
  if (/arxiv\.org|\.pdf$|doi\.org|pubmed|acm\.org|ieee\.org/.test(url)) return "paper";
  if (/\/docs?\/|docs\.|readthedocs|developer\.|\/reference\//.test(url)) return "docs";
  if (/github\.com\/[^/]+\/[^/]+\/?$|npmjs\.com\/package|pypi\.org\/project/.test(url)) {
    return "tool";
  }
  if (ogType.includes("article")) return "article";
  if ((input.textLength ?? 0) > MIN_ARTICLE_CHARS) return "article";
  return "other";
}

export interface ExtractHtmlInput {
  url: string;
  html: string;
  finalUrl?: string;
}

export async function extractHtml(input: ExtractHtmlInput): Promise<ExtractedContent> {
  const baseUrl = input.finalUrl ?? input.url;

  let document: ParsedDocument;
  try {
    const { parseHTML } = await import("linkedom");
    document = parseHTML(input.html).document;
  } catch (error) {
    log.warn("could not parse the HTML at all", {
      url: input.url,
      error: (error as Error).message,
    });
    return emptyExtract("other", "failed", "The page could not be parsed as HTML.");
  }

  // Metadata first, so it is available whether or not Readability succeeds. readMetadata
  // guards each read, and this catches the rest: a damaged document must cost us the
  // metadata, never the link.
  let meta: ReturnType<typeof readMetadata>;
  try {
    meta = readMetadata(document as never, baseUrl);
  } catch (error) {
    log.info("could not read this page's metadata", {
      url: input.url,
      error: (error as Error).message,
    });
    meta = {
      title: null,
      siteName: null,
      author: null,
      publishedAt: null,
      imageUrl: null,
      description: null,
      language: null,
      ogType: null,
      canonicalUrl: null,
    };
  }

  let articleText: string | null = null;
  let articleTitle: string | null = null;
  let byline: string | null = null;
  let siteName: string | null = null;
  let lang: string | null = null;

  try {
    const { Readability } = await import("@mozilla/readability");
    // Readability mutates the document it is given, which is fine here: nothing else
    // reads it afterwards.
    const article = new Readability(document as never, {
      charThreshold: MIN_ARTICLE_CHARS,
    }).parse();
    if (article) {
      articleText = article.textContent ?? null;
      articleTitle = article.title ?? null;
      byline = article.byline ?? null;
      siteName = article.siteName ?? null;
      lang = article.lang ?? null;
    }
  } catch (error) {
    // A Readability crash is not a failure for us: the metadata path still works.
    log.info("readability could not parse this page", {
      url: input.url,
      error: (error as Error).message,
    });
  }

  let text = tidyText(articleText);

  // Readability works from document.body. On a page with no explicit <body> tag the
  // parsed body is empty even though the content is in the document, so fall back to the
  // whole documentElement. Worse text than Readability would give, and far better than
  // declaring a real article unreadable.
  if ((text?.length ?? 0) < MIN_ARTICLE_CHARS) {
    const whole = safelyReadText(document);
    if ((whole?.length ?? 0) > (text?.length ?? 0)) text = whole;
  }

  const hasRealContent = (text?.length ?? 0) >= MIN_ARTICLE_CHARS;

  // No article, so fall back to the description. Partial, not failed: there is something
  // to show and something for the AI to work from.
  const fallbackText = hasRealContent ? text : tidyText(meta.description);

  const title = articleTitle ?? meta.title;
  const contentType = guessContentType({
    url: baseUrl,
    ogType: meta.ogType,
    textLength: text?.length ?? 0,
  });

  if (!hasRealContent && !title && !fallbackText) {
    return emptyExtract(contentType, "failed", "The page had no readable content or metadata.");
  }

  return {
    status: hasRealContent ? "ok" : "partial",
    title,
    siteName: siteName ?? meta.siteName ?? hostAsSiteName(baseUrl),
    author: byline ?? meta.author,
    publishedAt: meta.publishedAt,
    imageUrl: meta.imageUrl,
    contentType,
    text: fallbackText,
    language: lang ? (lang.split(/[-_]/)[0] ?? null) : meta.language,
    finalUrl: meta.canonicalUrl ?? baseUrl,
    ...(hasRealContent
      ? {}
      : { note: "Only the page metadata was readable, so the summary is from the title." }),
  };
}

/** A sensible site name when the page does not declare one. */
export function hostAsSiteName(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
