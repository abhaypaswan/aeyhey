// SPDX-License-Identifier: AGPL-3.0-only
// Fetching a page a user pasted (PRD 8.1 FR-LINK-3, 17).
//
// This is the one place in Aeyhey that makes a request to an address a user chose, so it
// is the one place that has to be paranoid:
//
//   - every URL is checked by the SSRF guard before the request
//   - redirects are followed by hand, one at a time, so every hop is checked too. The
//     classic attack is a public host that 302s to 169.254.169.254
//   - the body is read in chunks and abandoned the moment it passes the cap, so a
//     multi-gigabyte response cannot exhaust memory
//   - a timeout covers the whole operation, not just the connection

import { assertFetchableUrl, BlockedUrlError, type UrlGuardOptions } from "../security/ssrf";
import { createLogger } from "../logger";

const log = createLogger("fetch");

/**
 * A normal browser user agent. Plenty of sites serve a different page, or a block page,
 * to anything that announces itself as a bot, and the user asked us to read a page they
 * can read themselves.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const MAX_REDIRECTS = 5;
export const MAX_BYTES = 5 * 1024 * 1024;

export interface FetchPageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowPrivate?: boolean;
  /** Swapped out in tests. */
  fetchImpl?: typeof fetch;
  resolve?: UrlGuardOptions["resolve"];
  /** Extra headers, for example an oEmbed Accept. */
  headers?: Record<string, string>;
}

export interface FetchedPage {
  /** Where we ended up, after redirects. */
  finalUrl: string;
  status: number;
  contentType: string;
  /** Decoded text, empty for a binary response. */
  body: string;
  /** Raw bytes, kept only for a PDF. */
  bytes?: Uint8Array;
  /** True when the response was cut off at the cap. */
  truncated: boolean;
  redirects: string[];
}

export type FetchFailureReason =
  "blocked" | "timeout" | "too_many_redirects" | "http_error" | "network" | "unsupported_type";

export class FetchPageError extends Error {
  constructor(
    readonly reason: FetchFailureReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchPageError";
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Content types we can do something useful with. */
const TEXTUAL = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
  "text/xml",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
];

export function classifyContentType(raw: string): "html" | "text" | "json" | "pdf" | "other" {
  const type = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "application/pdf") return "pdf";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "application/json") return "json";
  if (TEXTUAL.includes(type)) return "text";
  return "other";
}

/** Reads the body in chunks and stops at the cap, rather than buffering it all first. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  // A declared length over the cap means we do not need to read it at all.
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    // Cancelling frees the socket instead of leaving it draining in the background.
    await response.body?.cancel();
    return { bytes: new Uint8Array(0), truncated: true };
  }

  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    // Always let go of the socket, including on a truncation or a throw.
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/** Honours a charset in the content type, falling back to utf-8. */
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const match = /charset=["']?([^;"'\s]+)/i.exec(contentType);
  const charset = match?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** Rejects when the deadline fires, so it can be raced against the request. */
function rejectOnAbort(signal: AbortSignal, url: string, timeoutMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void =>
      reject(new FetchPageError("timeout", `Fetching ${url} took longer than ${timeoutMs}ms.`));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

export async function fetchPage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;

  const guardOptions: UrlGuardOptions = {
    ...(options.allowPrivate !== undefined ? { allowPrivate: options.allowPrivate } : {}),
    ...(options.resolve ? { resolve: options.resolve } : {}),
  };

  // One deadline for the whole operation, redirects included, so a chain of slow hops
  // cannot add up past the timeout.
  const deadline = AbortSignal.timeout(timeoutMs);
  const redirects: string[] = [];
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Checked on every hop, not just the first. This is the whole point.
    const guarded = await assertFetchableUrl(current, guardOptions);

    let response: Response;
    try {
      const request = doFetch(guarded.url, {
        method: "GET",
        // We follow redirects ourselves so each target goes through the guard.
        redirect: "manual",
        signal: deadline,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
          "accept-language": "en,*;q=0.5",
          ...options.headers,
        },
      });

      // The signal above is the real mechanism, but we do not get to assume the fetch
      // implementation honours it. Racing the deadline means a worker thread can never be
      // parked forever by one unresponsive host.
      response = await Promise.race([request, rejectOnAbort(deadline, current, timeoutMs)]);
    } catch (error) {
      if (deadline.aborted) {
        throw new FetchPageError("timeout", `Fetching ${current} took longer than ${timeoutMs}ms.`);
      }
      throw new FetchPageError(
        "network",
        `Could not reach ${current}: ${(error as Error).message}`,
      );
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();

      if (!location) {
        throw new FetchPageError(
          "http_error",
          `${current} returned ${response.status} with no location to follow.`,
          response.status,
        );
      }
      // Relative redirects are normal and must resolve against the current URL.
      const next = new URL(location, guarded.url).toString();
      redirects.push(next);
      current = next;
      continue;
    }

    if (response.status >= 400) {
      await response.body?.cancel();
      throw new FetchPageError(
        "http_error",
        `${current} returned ${response.status}.`,
        response.status,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const kind = classifyContentType(contentType);
    const { bytes, truncated } = await readCapped(response, maxBytes);

    if (truncated) {
      log.info("response hit the size cap", { url: current, maxBytes });
    }

    return {
      finalUrl: guarded.url.toString(),
      status: response.status,
      contentType,
      body: kind === "pdf" || kind === "other" ? "" : decodeBody(bytes, contentType),
      ...(kind === "pdf" ? { bytes } : {}),
      truncated,
      redirects,
    };
  }

  throw new FetchPageError(
    "too_many_redirects",
    `${rawUrl} redirected more than ${MAX_REDIRECTS} times.`,
  );
}

export { BlockedUrlError };
