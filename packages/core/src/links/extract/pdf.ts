// SPDX-License-Identifier: AGPL-3.0-only
// PDFs linked directly, which is mostly papers (PRD 8.1 FR-LINK-3).
//
// unpdf is a build of pdf.js meant for servers, so it does not need canvas or a DOM. We
// only ever extract text: nothing here renders a page, which is why canvas is excluded
// from the install entirely.

import { emptyExtract, tidyText, type ExtractedContent } from "./types";
import { createLogger } from "../../logger";

const log = createLogger("extract:pdf");

export function looksLikePdf(input: { url: string; contentType?: string }): boolean {
  if (input.contentType?.toLowerCase().includes("application/pdf")) return true;
  try {
    return new URL(input.url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** A guess at the title from the first lines, when the PDF has no metadata title. */
function titleFromText(text: string): string | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines.slice(0, 5)) {
    // A title is usually a short line of words, not a page number or a URL.
    if (line.length >= 15 && line.length <= 200 && /[a-z]/i.test(line) && !/^https?:/i.test(line)) {
      return line;
    }
  }
  return null;
}

export async function extractPdf(input: {
  url: string;
  bytes: Uint8Array;
}): Promise<ExtractedContent> {
  if (input.bytes.byteLength === 0) {
    return emptyExtract("paper", "failed", "The PDF was empty or too large to download.");
  }

  // A PDF always starts with %PDF. Anything else means we were served something else,
  // such as a login page with a PDF content type.
  const magic = new TextDecoder().decode(input.bytes.subarray(0, 5));
  if (!magic.startsWith("%PDF")) {
    return emptyExtract("paper", "failed", "That file is not a PDF, whatever it claimed to be.");
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    const body = tidyText(Array.isArray(text) ? text.join("\n\n") : text);
    if (!body) {
      return emptyExtract(
        "paper",
        "partial",
        "This PDF has no extractable text, which usually means it is a scan.",
      );
    }

    const metaTitle = await readPdfTitle(pdf);

    return {
      status: "ok",
      title: metaTitle ?? titleFromText(body),
      contentType: "paper",
      text: body,
      finalUrl: input.url,
      note: totalPages > 0 ? `${totalPages} page PDF.` : null,
    };
  } catch (error) {
    log.warn("could not read the PDF", { url: input.url, error: (error as Error).message });
    return emptyExtract("paper", "failed", "This PDF could not be read.");
  }
}

async function readPdfTitle(pdf: unknown): Promise<string | null> {
  try {
    const doc = pdf as { getMetadata(): Promise<{ info?: { Title?: string } }> };
    const metadata = await doc.getMetadata();
    const title = metadata.info?.Title?.trim();
    return title && title.length > 2 ? title : null;
  } catch {
    return null;
  }
}
