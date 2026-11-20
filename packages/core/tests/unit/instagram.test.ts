// SPDX-License-Identifier: AGPL-3.0-only
// Instagram posts and reels: the caption comes from the meta tags Instagram serves to a
// client that says what it is.

import { afterEach, describe, expect, it } from "vitest";
import {
  extractInstagram,
  INSTAGRAM_USER_AGENT,
  isInstagramPostUrl,
  parseInstagramDescription,
} from "../../src/links/extract/instagram";

const REEL_HTML = `<!doctype html><html lang="en"><head><title>Instagram</title>
<meta property="og:title" content="Keshav Bedi on Instagram: &quot;On the budget&quot;" />
<meta property="og:description" content="pureeconomics on November 20, 2026: &quot;On the budget, and what it means for you
.
.
#economy #budget&quot;." />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/reel.jpg" />
</head><body></body></html>`;

const SHELL_HTML = `<!doctype html><html><head><title>Instagram</title></head><body></body></html>`;

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serve(html: string, seen: string[] = []) {
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>)["user-agent"] ?? "");
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

describe("Instagram links", () => {
  it("recognises posts and reels, and nothing else on the site", () => {
    expect(isInstagramPostUrl("https://www.instagram.com/reel/Df-EJmBT9ht/?dmpr=x")).toBe(true);
    expect(isInstagramPostUrl("https://instagram.com/p/C1abc/")).toBe(true);
    expect(isInstagramPostUrl("https://www.instagram.com/someone/reel/Df-EJmBT9ht/")).toBe(true);
    expect(isInstagramPostUrl("https://www.instagram.com/someone/")).toBe(false);
    expect(isInstagramPostUrl("https://example.com/reel/abc")).toBe(false);
  });

  it("splits the description into handle, date and caption", () => {
    expect(parseInstagramDescription('ada on May 1, 2026: "Hello\n.\n#hi".')).toEqual({
      handle: "ada",
      date: "May 1, 2026",
      caption: "Hello\n#hi",
    });
  });

  it("builds a card from the caption, asking as Aeyhey rather than as a browser", async () => {
    const seen: string[] = [];
    serve(REEL_HTML, seen);
    const result = await extractInstagram("https://www.instagram.com/reel/Df-EJmBT9ht/", {
      allowPrivate: true,
    });

    expect(seen[0]).toBe(INSTAGRAM_USER_AGENT);
    expect(result.status).toBe("partial");
    expect(result.title).toBe("On the budget, and what it means for you");
    expect(result.author).toBe("Keshav Bedi (@pureeconomics)");
    expect(result.contentType).toBe("video");
    expect(result.publishedAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(result.text).toContain("Instagram reel by Keshav Bedi (@pureeconomics)");
    expect(result.text).toContain("#economy #budget");
  });

  it("has no text when Instagram shows no caption, so nothing is guessed", async () => {
    serve(SHELL_HTML);
    const result = await extractInstagram("https://www.instagram.com/p/C1abc/", {
      allowPrivate: true,
    });
    expect(result.status).toBe("partial");
    expect(result.text ?? null).toBeNull();
    expect(result.note).toMatch(/private/);
  });
});
