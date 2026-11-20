// SPDX-License-Identifier: AGPL-3.0-only
// The extractor dispatcher (PRD 8.1 FR-LINK-3).
//
// The contract this file guarantees, and the acceptance criterion the PRD sets, is the
// same sentence: every link ends up ok, partial or failed, and never throws. A link the
// user saved is worth bringing back even if all we have is its URL, so there is no path
// through here that loses one.

import { classifyContentType, fetchPage, FetchPageError, type FetchPageOptions } from "../fetch";
import { BlockedUrlError } from "../../security/ssrf";
import { extractHtml, guessContentType, hostAsSiteName } from "./generic";
import { extractXPost, isXStatusUrl } from "./x";
import { extractYouTube, isYouTubeUrl } from "./youtube";
import { extractInstagram, isInstagramPostUrl } from "./instagram";
import { extractPdf, looksLikePdf } from "./pdf";
import { emptyExtract, tidyText, type ExtractedContent } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("extract");

export interface ExtractLinkInput {
  url: string;
  options?: FetchPageOptions & { skipTranscript?: boolean };
}

/**
 * A last-resort result built from the URL alone. The AI can still write something from a
 * hostname and a path, labelled as a summary from the title only (PRD 8.1 FR-LINK-4).
 */
function fromUrlOnly(url: string, note: string): ExtractedContent {
  let title: string | null = null;
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      // A slug is usually the title with hyphens in it.
      title = decodeURIComponent(lastSegment)
        .replace(/\.(html?|php|aspx?)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (title.length < 3 || /^\d+$/.test(title)) title = null;
      else title = title.charAt(0).toUpperCase() + title.slice(1);
    }
  } catch {
    title = null;
  }

  return {
    status: "failed",
    title,
    siteName: hostAsSiteName(url),
    contentType: guessContentType({ url }),
    note,
  };
}

export async function extractLink(input: ExtractLinkInput): Promise<ExtractedContent> {
  const { url } = input;
  const options = input.options ?? {};

  try {
    // The specialised extractors go first: for these three, the generic HTML path would
    // produce nothing useful.
    if (isXStatusUrl(url)) return await extractXPost(url, options);
    if (isYouTubeUrl(url)) return await extractYouTube(url, options);
    if (isInstagramPostUrl(url)) return await extractInstagram(url, options);

    // A .pdf URL still gets fetched the normal way, because the server may disagree about
    // what it is serving.
    const page = await fetchPage(url, options);
    const kind = classifyContentType(page.contentType);

    if (kind === "pdf" || (looksLikePdf({ url, contentType: page.contentType }) && page.bytes)) {
      if (!page.bytes) {
        return fromUrlOnly(url, "This PDF was too large to download.");
      }
      return await extractPdf({ url: page.finalUrl, bytes: page.bytes });
    }

    if (kind === "html") {
      return await extractHtml({ url, html: page.body, finalUrl: page.finalUrl });
    }

    if (kind === "text" || kind === "json") {
      const text = tidyText(page.body);
      if (!text) return fromUrlOnly(url, "That page was empty.");
      return {
        status: "ok",
        title: null,
        siteName: hostAsSiteName(page.finalUrl),
        contentType: guessContentType({ url, textLength: text.length }),
        text,
        finalUrl: page.finalUrl,
      };
    }

    // An image, a video file, a zip. We cannot read it, but the link is still saved.
    return fromUrlOnly(url, `Aeyhey cannot read a ${page.contentType.split(";")[0]} file.`);
  } catch (error) {
    // Every failure mode below still returns a result. This is the part the acceptance
    // criterion is really about.
    if (error instanceof BlockedUrlError) {
      log.warn("refused to fetch a blocked URL", { url, detail: error.detail });
      return emptyExtract(
        guessContentType({ url }),
        "failed",
        "Aeyhey will not fetch that address. It is a private or local one.",
      );
    }

    if (error instanceof FetchPageError) {
      const note =
        error.reason === "timeout"
          ? "That page took too long to respond."
          : error.reason === "http_error"
            ? `That page returned ${error.status ?? "an error"}.`
            : error.reason === "too_many_redirects"
              ? "That page redirected too many times."
              : "That page could not be reached.";
      log.info("fetch failed", { url, reason: error.reason, status: error.status });
      return fromUrlOnly(url, note);
    }

    log.error("an extractor threw unexpectedly", { url, error: (error as Error).message });
    return fromUrlOnly(url, "Something went wrong reading that page.");
  }
}

export * from "./types";
export * from "./metadata";
export { extractHtml, guessContentType, hostAsSiteName } from "./generic";
export { extractXPost, isXStatusUrl, textFromOEmbedHtml } from "./x";
export { extractYouTube, isYouTubeUrl, youTubeVideoId } from "./youtube";
export { extractPdf, looksLikePdf } from "./pdf";
