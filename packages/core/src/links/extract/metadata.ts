// SPDX-License-Identifier: AGPL-3.0-only
// Reading the metadata every page carries, independent of Readability.
//
// Open Graph first, then Twitter cards, then the plain HTML elements. This runs even when
// Readability finds no article, which is what lets a failed extraction still produce a
// usable card.

import { parseDate } from "./types";

export interface PageMetadata {
  title: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: Date | null;
  imageUrl: string | null;
  description: string | null;
  language: string | null;
  /** og:type, which tells us video from article more reliably than guessing. */
  ogType: string | null;
  canonicalUrl: string | null;
}

/** A minimal shape so this works with any DOM, and with none in tests. */
interface MinimalDocument {
  title?: string;
  querySelector(
    selector: string,
  ): { getAttribute(name: string): string | null; textContent?: string | null } | null;
  documentElement?: { getAttribute(name: string): string | null } | null;
}

function content(doc: MinimalDocument, selectors: string[]): string | null {
  for (const selector of selectors) {
    try {
      const value = doc.querySelector(selector)?.getAttribute("content");
      const tidy = value?.trim();
      if (tidy) return tidy;
    } catch {
      // A selector that throws on a damaged document is not worth failing the page for.
    }
  }
  return null;
}

/**
 * Reading a property off a DOM we did not build can throw, not just return null. linkedom
 * hands back a document with a null documentElement for input that is not really markup,
 * and its `title` getter walks into that and throws. Every read here goes through this.
 */
function emptyToNull(value: string | null): string | null {
  return value && value.trim() !== "" ? value : null;
}

function safely<T>(read: () => T | null | undefined): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

export function readMetadata(doc: MinimalDocument, baseUrl?: string): PageMetadata {
  // document.title comes last and is not trusted on its own. A page served as minified
  // HTML with no explicit <head> or <body>, which plenty of hand-rolled static sites do,
  // parses into a document whose `title` property is empty even though the <title>
  // element is right there. So the element itself is checked too.
  const title =
    content(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ??
    emptyToNull(safely(() => doc.title?.trim())) ??
    emptyToNull(safely(() => doc.querySelector("title")?.textContent?.trim())) ??
    null;

  const imageRaw = content(doc, [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ]);

  // An og:image is often a relative path, which is useless to the browser later.
  let imageUrl: string | null = imageRaw;
  if (imageRaw && baseUrl) {
    try {
      imageUrl = new URL(imageRaw, baseUrl).toString();
    } catch {
      imageUrl = null;
    }
  }

  const canonicalRaw = safely(() =>
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
  );
  let canonicalUrl: string | null = canonicalRaw;
  if (canonicalRaw && baseUrl) {
    try {
      canonicalUrl = new URL(canonicalRaw, baseUrl).toString();
    } catch {
      canonicalUrl = null;
    }
  }

  const language =
    safely(() => doc.documentElement?.getAttribute("lang")?.trim().slice(0, 8)) ??
    content(doc, ['meta[property="og:locale"]']) ??
    null;

  return {
    title,
    siteName: content(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']),
    author:
      content(doc, [
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="twitter:creator"]',
      ]) ?? null,
    publishedAt: parseDate(
      content(doc, [
        'meta[property="article:published_time"]',
        'meta[property="og:published_time"]',
        'meta[name="date"]',
        'meta[name="publish-date"]',
      ]) ?? safely(() => doc.querySelector("time[datetime]")?.getAttribute("datetime")),
    ),
    imageUrl,
    description: content(doc, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]),
    language: language ? language.split(/[-_]/)[0]! : null,
    ogType: content(doc, ['meta[property="og:type"]']),
    canonicalUrl,
  };
}
