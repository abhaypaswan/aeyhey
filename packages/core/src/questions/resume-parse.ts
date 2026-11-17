// SPDX-License-Identifier: AGPL-3.0-only
// Reading a resume (PRD 8.2 FR-Q-2, FR-Q-7, 17).
//
// Two things matter more here than anywhere else in the app:
//
//   1. Privacy. A resume is the most personal thing a user will hand us. The file is
//      deleted after parsing unless they tick "keep my resume file", and emails and
//      phone numbers are stripped before the text goes to a hosted model. With Ollama
//      nothing leaves the machine, so there is nothing to strip for.
//   2. Honesty about what we read. The extracted text is shown back to the user to
//      confirm before anything is generated, because a PDF that parsed badly produces
//      questions about nothing, and the user is the only one who can tell.

import { createLogger } from "../logger";

const log = createLogger("resume");

export const MAX_RESUME_CHARS = 15_000;

/**
 * How much of a study document is kept. A whole book does not fit, so the first part is
 * kept and generation works through it in slices (see questions/generate.ts).
 */
export const MAX_DOCUMENT_CHARS = 120_000;

export type ResumeFileKind = "pdf" | "docx" | "text";

export interface ParseResumeInput {
  bytes: Uint8Array;
  /** The browser's content type, which is a hint rather than the truth. */
  declaredType?: string;
  filename?: string;
}

export interface ParsedResume {
  kind: ResumeFileKind;
  text: string;
  /** What the PII pass removed, so the upload screen can say so. */
  redactions: { emails: number; phones: number };
  /** True when the text looks too short or too garbled to generate from. */
  suspicious: boolean;
  note?: string;
}

export class UnsupportedResumeError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedResumeError";
  }
}

/**
 * Magic bytes, not the declared content type. A browser will happily label anything, and
 * this decides which parser runs (PRD 17 uploads).
 */
export function sniffFileKind(bytes: Uint8Array, declaredType?: string): ResumeFileKind | null {
  if (bytes.byteLength >= 5) {
    const head = new TextDecoder().decode(bytes.subarray(0, 5));
    if (head.startsWith("%PDF")) return "pdf";
    // DOCX is a zip. So is every other Office format, so the content type breaks the tie.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) {
      if (
        !declaredType ||
        declaredType.includes("word") ||
        declaredType.includes("officedocument")
      ) {
        return "docx";
      }
      return null;
    }
  }

  // Plain text: no control characters outside the usual whitespace.
  const sample = bytes.subarray(0, 1000);
  const binary = [...sample].some((byte) => byte === 0 || byte < 9 || (byte > 13 && byte < 32));
  return binary ? null : "text";
}

/** Emails and phone numbers, before anything goes to a hosted model (PRD 17, 13.2). */
export function stripPii(text: string): { text: string; emails: number; phones: number } {
  let emails = 0;
  let phones = 0;

  let out = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => {
    emails += 1;
    return "[email removed]";
  });

  // Deliberately broad: a false positive costs a model nothing, a missed phone number is
  // a real leak. Requires 9 or more digits so it does not eat dates or version numbers.
  out = out.replace(
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g,
    (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) return match;
      phones += 1;
      return "[phone removed]";
    },
  );

  return { text: out, emails, phones };
}

/** Collapses the whitespace a PDF extractor leaves behind, keeping paragraph breaks. */
function tidyResumeText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // A PDF often gives one word per line; join lines that clearly continue a sentence.
      .replace(/([a-z,])\n([a-z])/g, "$1 $2")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Catches a parse that technically succeeded but produced nothing usable: a scanned PDF,
 * or a file where the extractor returned page furniture only. The user is shown the text
 * and asked to confirm, so this only decides whether to warn them.
 */
function looksSuspicious(text: string): { suspicious: boolean; note?: string } {
  if (text.length < 200) {
    return {
      suspicious: true,
      note: "That came out very short. If this is a scanned PDF, paste the text instead.",
    };
  }

  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters / text.length < 0.5) {
    return {
      suspicious: true,
      note: "That text looks garbled. Check it below, or paste the text instead.",
    };
  }

  const words = text.split(/\s+/).filter((word) => word.length > 1);
  if (words.length < 80) {
    return {
      suspicious: true,
      note: "That looks like only part of the document. Check it below before generating.",
    };
  }

  return { suspicious: false };
}

async function parsePdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function parseDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  // extractRawText rather than convertToHtml: we want the words, and markup would only
  // have to be stripped again before it reached a prompt.
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

export interface ParseOptions {
  /** From the user's settings. Default on (PRD 8.4, 17). */
  stripPii?: boolean;
  maxChars?: number;
}

export async function parseResumeFile(
  input: ParseResumeInput,
  options: ParseOptions = {},
): Promise<ParsedResume> {
  const kind = sniffFileKind(input.bytes, input.declaredType);

  if (!kind) {
    throw new UnsupportedResumeError(
      "Aeyhey can read a PDF, a Word document or plain text. Try one of those, or paste the text.",
    );
  }

  let raw: string;
  try {
    raw =
      kind === "pdf"
        ? await parsePdf(input.bytes)
        : kind === "docx"
          ? await parseDocx(input.bytes)
          : new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
  } catch (error) {
    log.warn("could not parse a resume", { kind, error: (error as Error).message });
    throw new UnsupportedResumeError(
      kind === "pdf"
        ? "That PDF could not be read. If it is a scan, paste the text instead."
        : "That file could not be read. Try saving it as a PDF, or paste the text.",
    );
  }

  return finishParse(raw, kind, options);
}

/** The pasted-text path. Same cleaning and the same PII rules (PRD 8.2 FR-Q-2). */
export function parseResumeText(text: string, options: ParseOptions = {}): ParsedResume {
  return finishParse(text, "text", options);
}

function finishParse(raw: string, kind: ResumeFileKind, options: ParseOptions): ParsedResume {
  const tidy = tidyResumeText(raw);

  const {
    text: stripped,
    emails,
    phones,
  } = options.stripPii === false ? { text: tidy, emails: 0, phones: 0 } : stripPii(tidy);

  const clipped = stripped.slice(0, options.maxChars ?? MAX_RESUME_CHARS);
  const { suspicious, note } = looksSuspicious(clipped);

  return {
    kind,
    text: clipped,
    redactions: { emails, phones },
    suspicious,
    ...(note ? { note } : {}),
  };
}

/**
 * Reads any study document: a book, notes, a paper, slides saved as PDF. Same readers as a
 * resume, but nothing is redacted, because a textbook has no one's phone number in it and
 * a redaction there would only mangle the text.
 */
export async function parseDocumentFile(input: ParseResumeInput): Promise<ParsedResume> {
  return parseResumeFile(input, { stripPii: false, maxChars: MAX_DOCUMENT_CHARS });
}

export function parseDocumentText(text: string): ParsedResume {
  return parseResumeText(text, { stripPii: false, maxChars: MAX_DOCUMENT_CHARS });
}
