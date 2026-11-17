// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { normalizeUrl, sameLink } from "../../src/links/normalize";
import { extractUrls } from "../../src/links/extract-urls";

const norm = (input: string) => normalizeUrl(input)?.normalized;

describe("normalizeUrl", () => {
  it("lowercases the host and strips www", () => {
    expect(norm("https://WWW.Example.COM/Path")).toBe("https://example.com/Path");
  });

  it("keeps path case, because paths are often case sensitive", () => {
    expect(norm("https://example.com/Blog/MyPost")).toBe("https://example.com/Blog/MyPost");
  });

  it("strips the fragment and the trailing slash", () => {
    expect(norm("https://example.com/post/#section")).toBe("https://example.com/post");
    expect(norm("https://example.com/")).toBe("https://example.com/");
  });

  it("strips utm and other tracking parameters but keeps real ones", () => {
    expect(norm("https://example.com/a?utm_source=x&utm_medium=y&id=7")).toBe(
      "https://example.com/a?id=7",
    );
    expect(norm("https://example.com/a?fbclid=abc&gclid=def")).toBe("https://example.com/a");
    expect(norm("https://example.com/search?q=postgres+index")).toBe(
      "https://example.com/search?q=postgres+index",
    );
  });

  it("sorts query parameters so order does not create a duplicate", () => {
    expect(norm("https://example.com/a?b=2&a=1")).toBe(norm("https://example.com/a?a=1&b=2"));
  });

  it("turns twitter.com into x.com and drops s and t", () => {
    expect(norm("https://twitter.com/jane/status/123?s=20&t=abc")).toBe(
      "https://x.com/jane/status/123",
    );
    expect(norm("https://mobile.twitter.com/jane/status/123")).toBe(
      "https://x.com/jane/status/123",
    );
    expect(sameLink("https://twitter.com/jane/status/123", "https://x.com/jane/status/123")).toBe(
      true,
    );
  });

  it("canonicalizes every YouTube form to watch?v=ID", () => {
    const expected = "https://youtube.com/watch?v=dQw4w9WgXcQ";
    expect(norm("https://youtu.be/dQw4w9WgXcQ")).toBe(expected);
    expect(norm("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(expected);
    expect(norm("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toBe(expected);
    expect(norm("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(expected);
    expect(norm("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(expected);
  });

  it("keeps a YouTube timestamp, which changes what you watch", () => {
    expect(norm("https://youtube.com/watch?v=abc123&t=90")).toBe(
      "https://youtube.com/watch?t=90&v=abc123",
    );
  });

  it("assumes https for a bare domain", () => {
    expect(norm("example.com/post")).toBe("https://example.com/post");
  });

  it("trims trailing punctuation picked up from prose", () => {
    expect(norm("https://example.com/post).")).toBe("https://example.com/post");
    expect(norm("https://example.com/post,")).toBe("https://example.com/post");
  });

  it("refuses anything that is not http or https", () => {
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("mailto:someone@example.com")).toBeNull();
    expect(normalizeUrl("not a url at all")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("pulls URLs out of prose and keeps the paste order", () => {
    const result = extractUrls(`
      Some notes to self.
      First https://example.com/one then a thought
      and https://example.com/two at the end.
    `);
    expect(result.urls.map((u) => u.normalized)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
    expect(result.urls[0]!.position).toBe(0);
  });

  it("meets the acceptance criterion: 50 URLs with 5 duplicates and junk gives 45", () => {
    const unique = Array.from({ length: 45 }, (_, i) => `https://example.com/article-${i}`);
    const duplicates = unique.slice(0, 5);
    const lines: string[] = [];
    for (const [index, url] of [...unique, ...duplicates].entries()) {
      lines.push(`note ${index}: ${url}`);
      if (index % 7 === 0) lines.push("just some text with no link in it");
    }

    const result = extractUrls(lines.join("\n"));
    expect(result.urls).toHaveLength(45);
    expect(result.duplicatesInText).toBe(5);
  });

  it("dedupes forms that normalize to the same link", () => {
    const result = extractUrls(`
      https://twitter.com/jane/status/9?s=20
      https://x.com/jane/status/9
      https://www.x.com/jane/status/9
    `);
    expect(result.urls).toHaveLength(1);
    expect(result.duplicatesInText).toBe(2);
  });

  it("finds a bare domain and does not double count a scheme-ful one", () => {
    const result = extractUrls("read example.com/post and https://other.com/x");
    expect(result.urls.map((u) => u.normalized).sort()).toEqual([
      "https://example.com/post",
      "https://other.com/x",
    ]);
  });

  it("does not match a bare domain already inside a full URL", () => {
    const result = extractUrls("https://example.com/path/to/thing");
    expect(result.urls).toHaveLength(1);
  });

  it("can be told to ignore bare domains", () => {
    const result = extractUrls("example.com/post", { includeBareDomains: false });
    expect(result.urls).toHaveLength(0);
  });

  it("returns nothing for text with no links", () => {
    expect(extractUrls("just a plain sentence, nothing to save").urls).toHaveLength(0);
  });
});

describe("scheme handling edge cases", () => {
  it("does not mistake a port for a scheme", () => {
    expect(normalizeUrl("example.com:8080/x")?.normalized).toBe("https://example.com:8080/x");
  });

  it("refuses a URL with credentials in it", () => {
    expect(normalizeUrl("https://user:pass@example.com/x")).toBeNull();
  });

  it("keeps an explicit http URL as http for opening", () => {
    const result = normalizeUrl("http://example.com/x");
    expect(result?.url).toBe("http://example.com/x");
    // The dedupe key is scheme independent, so http and https are the same saved thing.
    expect(result?.normalized).toBe("https://example.com/x");
  });
});
