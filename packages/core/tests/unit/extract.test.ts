// SPDX-License-Identifier: AGPL-3.0-only
// PRD 8.1 FR-LINK-3 acceptance criterion: for 10 fixture pages (article, X post, YouTube,
// PDF, 404, timeout and others), each ends ok, partial or failed without crashing, and
// every link gets a card.

import { describe, expect, it } from "vitest";
import { extractLink } from "../../src/links/extract/index";
import { extractHtml, guessContentType } from "../../src/links/extract/generic";
import { textFromOEmbedHtml, isXStatusUrl } from "../../src/links/extract/x";
import { youTubeVideoId, isYouTubeUrl } from "../../src/links/extract/youtube";
import { looksLikePdf } from "../../src/links/extract/pdf";
import { readMetadata } from "../../src/links/extract/metadata";
import { estimateReadMinutes, tidyText } from "../../src/links/extract/types";
import { classifyContentType, fetchPage, FetchPageError } from "../../src/links/fetch";
import { BlockedUrlError } from "../../src/security/ssrf";

const ARTICLE_HTML = `<!doctype html><html lang="en"><head>
<title>Choosing a Postgres index</title>
<meta property="og:site_name" content="Example Blog">
<meta property="og:image" content="/img/cover.png">
<meta name="author" content="Jane Roe">
<meta property="article:published_time" content="2026-03-04T10:00:00Z">
<meta property="og:type" content="article">
<meta name="description" content="When to reach for a GIN index instead of a b-tree.">
<link rel="canonical" href="https://example.com/postgres-index">
</head><body>
<nav>Home About Newsletter</nav>
<article><h1>Choosing a Postgres index</h1>
<p>A b-tree index is the default in Postgres and it suits equality and range lookups on ordered data. It is what you get when you write CREATE INDEX with no other words, and most of the time it is the right answer.</p>
<p>A GIN index suits containment queries, which is what you want for jsonb columns and for full text search. It costs more to write and more disk, and it pays that back when your queries ask whether a document contains something.</p>
<p>Choosing between them comes down to the shape of the query rather than the type of the column, so measure with your own data before you decide. EXPLAIN ANALYZE on a realistic row count will tell you more than any blog post, including this one.</p>
</article><footer>Copyright 2026</footer></body></html>`;

/** A fetch stand-in driven by a table of routes, so no test touches the network. */
function stubFetch(
  routes: Record<
    string,
    { status?: number; contentType?: string; body?: string | Uint8Array; delayMs?: number }
  >,
): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!key) {
      throw new TypeError(`fetch failed: nothing stubbed for ${url}`);
    }
    const route = routes[key]!;

    if (route.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, route.delayMs));
    }

    const payload = route.body ?? "";
    const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;

    return new Response(bytes.buffer as ArrayBuffer, {
      status: route.status ?? 200,
      headers: {
        "content-type": route.contentType ?? "text/html; charset=utf-8",
        "content-length": String(bytes.byteLength),
      },
    });
  }) as unknown as typeof fetch;
}

/** Every host resolves to a public address, so the SSRF guard lets the stub through. */
const publicResolve = async () => ["93.184.216.34"];

const baseOptions = { resolve: publicResolve, skipTranscript: true };

describe("content type classification", () => {
  it("recognises the types we handle", () => {
    expect(classifyContentType("text/html; charset=utf-8")).toBe("html");
    expect(classifyContentType("application/pdf")).toBe("pdf");
    expect(classifyContentType("application/json")).toBe("json");
    expect(classifyContentType("text/plain")).toBe("text");
    expect(classifyContentType("image/png")).toBe("other");
    expect(classifyContentType("")).toBe("other");
  });
});

describe("url recognition", () => {
  it("spots an X status URL and not a profile", () => {
    expect(isXStatusUrl("https://x.com/jane/status/123")).toBe(true);
    expect(isXStatusUrl("https://twitter.com/jane/status/123")).toBe(true);
    expect(isXStatusUrl("https://x.com/jane")).toBe(false);
    expect(isXStatusUrl("https://example.com/jane/status/123")).toBe(false);
  });

  it("pulls a video id out of every YouTube shape", () => {
    expect(youTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeVideoId("https://example.com/watch?v=x")).toBeNull();
    expect(isYouTubeUrl("https://example.com")).toBe(false);
  });

  it("spots a PDF by extension or by content type", () => {
    expect(looksLikePdf({ url: "https://arxiv.org/pdf/2301.00001.pdf" })).toBe(true);
    expect(looksLikePdf({ url: "https://example.com/x", contentType: "application/pdf" })).toBe(
      true,
    );
    expect(looksLikePdf({ url: "https://example.com/x" })).toBe(false);
  });
});

describe("metadata", () => {
  it("reads og tags and resolves a relative image against the page URL", async () => {
    const { parseHTML } = await import("linkedom");
    const meta = readMetadata(
      parseHTML(ARTICLE_HTML).document as never,
      "https://example.com/postgres-index",
    );

    expect(meta.title).toBe("Choosing a Postgres index");
    expect(meta.siteName).toBe("Example Blog");
    expect(meta.author).toBe("Jane Roe");
    expect(meta.imageUrl).toBe("https://example.com/img/cover.png");
    expect(meta.language).toBe("en");
    expect(meta.publishedAt?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(meta.canonicalUrl).toBe("https://example.com/postgres-index");
  });

  it("ignores a published date far in the future", async () => {
    const { parseHTML } = await import("linkedom");
    const html = `<html><head><meta property="article:published_time" content="2999-01-01"></head><body></body></html>`;
    expect(readMetadata(parseHTML(html).document as never).publishedAt).toBeNull();
  });
});

describe("the generic HTML extractor", () => {
  it("pulls the article out and leaves the navigation behind", async () => {
    const result = await extractHtml({
      url: "https://example.com/postgres-index",
      html: ARTICLE_HTML,
    });

    expect(result.status).toBe("ok");
    expect(result.title).toBe("Choosing a Postgres index");
    expect(result.author).toBe("Jane Roe");
    expect(result.contentType).toBe("article");
    expect(result.text).toContain("b-tree index is the default");
    expect(result.text).not.toContain("Newsletter");
    expect(result.text).not.toContain("Copyright 2026");
  });

  it("falls back to the description and reports partial when there is no article", async () => {
    const html = `<html lang="en"><head><title>A landing page</title>
      <meta name="description" content="A short marketing line and nothing else at all."></head>
      <body><div>Buy now</div></body></html>`;
    const result = await extractHtml({ url: "https://example.com/", html });

    expect(result.status).toBe("partial");
    expect(result.title).toBe("A landing page");
    expect(result.note).toMatch(/metadata/i);
  });

  it("reports failed when there is nothing at all, and still does not throw", async () => {
    const result = await extractHtml({ url: "https://example.com/", html: "<html></html>" });
    expect(result.status).toBe("failed");
  });

  it("survives markup that is not really HTML", async () => {
    const result = await extractHtml({ url: "https://example.com/", html: "}{not markup" });
    expect(["partial", "failed"]).toContain(result.status);
  });

  it("guesses a content type from the URL shape", () => {
    expect(guessContentType({ url: "https://youtube.com/watch?v=a" })).toBe("video");
    expect(guessContentType({ url: "https://x.com/a/status/1" })).toBe("thread");
    expect(guessContentType({ url: "https://arxiv.org/abs/2301.1" })).toBe("paper");
    expect(guessContentType({ url: "https://react.dev/reference/react" })).toBe("docs");
    expect(guessContentType({ url: "https://github.com/owner/repo" })).toBe("tool");
    expect(guessContentType({ url: "https://example.com/x", ogType: "article" })).toBe("article");
    expect(guessContentType({ url: "https://example.com/x" })).toBe("other");
  });
});

describe("the X oEmbed extractor", () => {
  it("turns the oEmbed blockquote into plain text", () => {
    const html =
      '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Shipping beats perfecting.<br>Every time.</p>&mdash; Jane Roe (@jane) <a href="https://twitter.com/jane/status/1">March 4, 2026</a></blockquote>';
    const text = textFromOEmbedHtml(html);
    expect(text).toContain("Shipping beats perfecting.");
    expect(text).toContain("Every time.");
    expect(text).not.toContain("<p");
    expect(text).not.toContain("March 4, 2026");
  });

  it("decodes entities and returns null for an empty post", () => {
    expect(textFromOEmbedHtml("<blockquote><p>a &amp; b &quot;c&quot;</p></blockquote>")).toBe(
      'a & b "c"',
    );
    expect(textFromOEmbedHtml("<blockquote><p></p></blockquote>")).toBeNull();
  });
});

describe("helpers", () => {
  it("collapses whitespace and caps stored text", () => {
    expect(tidyText("  a\n\n\n\nb   c  ")).toBe("a\n\nb c");
    expect(tidyText("")).toBeNull();
    expect(tidyText(null)).toBeNull();
    const long = tidyText("x".repeat(30_000));
    expect(long!.length).toBeLessThanOrEqual(20_003);
    expect(long!.endsWith("...")).toBe(true);
  });

  it("estimates read minutes at about 220 words a minute", () => {
    expect(estimateReadMinutes(null)).toBeNull();
    expect(estimateReadMinutes("one two three")).toBe(1);
    expect(estimateReadMinutes(Array(2200).fill("word").join(" "))).toBe(10);
  });
});

describe("the fetcher", () => {
  it("reads a normal page", async () => {
    const page = await fetchPage("https://example.com/a", {
      fetchImpl: stubFetch({ "https://example.com/a": { body: ARTICLE_HTML } }),
      resolve: publicResolve,
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain("b-tree");
  });

  it("follows a redirect and records the hop", async () => {
    const impl = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://example.com/old") {
        return new Response(null, { status: 301, headers: { location: "/new" } });
      }
      return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;

    const page = await fetchPage("https://example.com/old", {
      fetchImpl: impl,
      resolve: publicResolve,
    });
    expect(page.redirects).toEqual(["https://example.com/new"]);
    expect(page.finalUrl).toBe("https://example.com/new");
  });

  it("re-checks every redirect target, so a public host cannot bounce us to metadata", async () => {
    const impl = (async (input: URL | RequestInfo) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://example.com")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      throw new Error("the guard should have stopped this request");
    }) as unknown as typeof fetch;

    await expect(
      fetchPage("https://example.com/bounce", { fetchImpl: impl, resolve: publicResolve }),
    ).rejects.toThrow(BlockedUrlError);
  });

  it("refuses a redirect chain that never ends", async () => {
    const impl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/loop" },
      })) as unknown as typeof fetch;

    await expect(
      fetchPage("https://example.com/loop", { fetchImpl: impl, resolve: publicResolve }),
    ).rejects.toThrow(/redirected more than/);
  });

  it("turns an HTTP error into a typed failure", async () => {
    await expect(
      fetchPage("https://example.com/missing", {
        fetchImpl: stubFetch({ "https://example.com/missing": { status: 404, body: "gone" } }),
        resolve: publicResolve,
      }),
    ).rejects.toThrow(FetchPageError);
  });

  it("stops reading at the size cap instead of buffering it all", async () => {
    const page = await fetchPage("https://example.com/big", {
      fetchImpl: stubFetch({ "https://example.com/big": { body: "x".repeat(50_000) } }),
      resolve: publicResolve,
      maxBytes: 1_000,
    });
    expect(page.truncated).toBe(true);
  });

  it("times out rather than hanging", async () => {
    await expect(
      fetchPage("https://example.com/slow", {
        fetchImpl: stubFetch({ "https://example.com/slow": { delayMs: 200, body: "late" } }),
        resolve: publicResolve,
        timeoutMs: 30,
      }),
    ).rejects.toThrow(FetchPageError);
  });
});

describe("the acceptance criterion: 10 fixtures, none may crash", () => {
  const VALID = ["ok", "partial", "failed"];

  const minimalPdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  );

  const fixtures: { name: string; url: string; routes: Parameters<typeof stubFetch>[0] }[] = [
    {
      name: "a normal article",
      url: "https://example.com/postgres-index",
      routes: { "https://example.com/postgres-index": { body: ARTICLE_HTML } },
    },
    {
      name: "an X post",
      url: "https://x.com/jane/status/1",
      routes: {
        "https://publish.twitter.com/oembed": {
          contentType: "application/json",
          body: JSON.stringify({
            html: "<blockquote><p>A short post about indexes.</p></blockquote>",
            author_name: "Jane Roe",
            url: "https://x.com/jane/status/1",
          }),
        },
      },
    },
    {
      name: "an X post that oEmbed refuses",
      url: "https://x.com/jane/status/2",
      routes: { "https://publish.twitter.com/oembed": { status: 403, body: "no" } },
    },
    {
      name: "a YouTube video with no transcript",
      url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      routes: {
        "https://www.youtube.com/oembed": {
          contentType: "application/json",
          body: JSON.stringify({ title: "A talk about indexes", author_name: "Some Channel" }),
        },
        "https://www.youtube.com/watch": {
          body: '<html><head><meta property="og:description" content="A talk about how indexes work."></head><body></body></html>',
        },
      },
    },
    {
      name: "a direct PDF",
      url: "https://arxiv.org/pdf/2301.00001.pdf",
      routes: {
        "https://arxiv.org/pdf/2301.00001.pdf": {
          contentType: "application/pdf",
          body: minimalPdf,
        },
      },
    },
    {
      name: "a 404",
      url: "https://example.com/missing",
      routes: { "https://example.com/missing": { status: 404, body: "Not found" } },
    },
    {
      name: "a 500",
      url: "https://example.com/broken",
      routes: { "https://example.com/broken": { status: 500, body: "oops" } },
    },
    {
      name: "a timeout",
      url: "https://example.com/slow",
      routes: { "https://example.com/slow": { delayMs: 300, body: "late" } },
    },
    {
      name: "a landing page with no article",
      url: "https://example.com/pricing",
      routes: {
        "https://example.com/pricing": {
          body: '<html><head><title>Pricing</title><meta name="description" content="Plans and prices for the product."></head><body><div>Buy</div></body></html>',
        },
      },
    },
    {
      name: "a binary file we cannot read",
      url: "https://example.com/logo.png",
      routes: { "https://example.com/logo.png": { contentType: "image/png", body: "binary" } },
    },
    {
      name: "a host that does not resolve",
      url: "https://nope.invalid/x",
      routes: {},
    },
    {
      name: "a plain text file",
      url: "https://example.com/notes.txt",
      routes: {
        "https://example.com/notes.txt": {
          contentType: "text/plain",
          body: "Some notes about choosing an index, long enough to be worth keeping around.",
        },
      },
    },
  ];

  for (const fixture of fixtures) {
    it(`handles ${fixture.name}`, async () => {
      const result = await extractLink({
        url: fixture.url,
        options: {
          ...baseOptions,
          fetchImpl: stubFetch(fixture.routes),
          timeoutMs: fixture.name === "a timeout" ? 40 : 5_000,
        },
      });

      // The contract: a status we understand, a content type, and no throw.
      expect(VALID, `${fixture.name} returned ${result.status}`).toContain(result.status);
      expect(result.contentType).toBeTruthy();
      // Enough to build a card from: a title, some text, or at minimum a reason.
      expect(Boolean(result.title || result.text || result.note)).toBe(true);
    });
  }

  it("refuses a private address and still returns a result", async () => {
    const result = await extractLink({
      url: "http://192.168.1.1/admin",
      options: { fetchImpl: stubFetch({}) },
    });
    expect(result.status).toBe("failed");
    expect(result.note).toMatch(/private or local/i);
  });

  it("builds a title from the URL slug when nothing else is available", async () => {
    const result = await extractLink({
      url: "https://example.com/blog/choosing-a-postgres-index",
      options: {
        ...baseOptions,
        fetchImpl: stubFetch({ "https://example.com/blog": { status: 500 } }),
      },
    });
    expect(result.title).toBe("Choosing a postgres index");
  });
});

describe("minified HTML with no head or body tags", () => {
  // A real page found this: danluu.com serves
  //   <!DOCTYPE html><html lang=en><meta charset=utf-8><title>...</title>
  // with no <head> and no <body>. linkedom parses it, but document.title comes back empty
  // and document.body.textContent is zero length, so a genuine article was reported as
  // failed with no title at all. Plenty of hand-rolled static sites are built this way.
  const MINIFIED = `<!DOCTYPE html><html lang=en><meta charset=utf-8><title>Tail latency and why averages lie</title><meta name=viewport content="width=device-width"><p>An average latency hides the requests that actually annoy people, because the slow ones are rare enough to vanish into the mean but common enough that somebody hits one every minute.</p><p>p99 matters more than p50 once a page makes several calls, since the chance of hitting at least one slow call rises with every request the page makes.</p><p>Tail latency compounds: ten calls at p99 make a slow page likely rather than rare, which is why the number to watch is the one at the tail.</p>`;

  it("finds the title through the element when document.title is empty", async () => {
    const { parseHTML } = await import("linkedom");
    const document = parseHTML(MINIFIED).document;

    // The property really is empty. This is the condition being guarded against.
    expect(document.title).toBe("");

    const meta = readMetadata(document as never, "https://example.com/x");
    expect(meta.title).toBe("Tail latency and why averages lie");
  });

  it("reads the text from the document when the parsed body is empty", async () => {
    const result = await extractHtml({ url: "https://example.com/x", html: MINIFIED });

    expect(result.status).toBe("ok");
    expect(result.title).toBe("Tail latency and why averages lie");
    expect(result.text).toContain("p99 matters more than p50");
    expect((result.text ?? "").length).toBeGreaterThan(200);
  });

  it("still leaves out script and nav content when it falls back", async () => {
    const withNoise = `<!DOCTYPE html><html lang=en><title>A page</title><nav>Home About Contact</nav><script>var tracking = 1;</script><p>${"The actual article text that should survive the fallback. ".repeat(6)}</p><footer>Copyright notice</footer>`;
    const result = await extractHtml({ url: "https://example.com/x", html: withNoise });

    expect(result.text).toContain("actual article text");
    expect(result.text).not.toContain("var tracking");
    expect(result.text).not.toContain("Home About Contact");
    expect(result.text).not.toContain("Copyright notice");
  });
});
