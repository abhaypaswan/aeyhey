// SPDX-License-Identifier: AGPL-3.0-only
// The public page as an RSS 2.0 feed (PRD 28, FR-PUB-6). Same items as the page.

import { loadPublicPage } from "../../../../lib/public-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

function xml(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Characters XML 1.0 does not allow at all would make the whole feed unreadable.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { handle } = await params;
  const result = await loadPublicPage(handle);

  if (result.kind === "moved") {
    return new Response(null, {
      status: 301,
      headers: { location: `/u/${result.handle}/rss.xml` },
    });
  }
  if (result.kind === "missing") {
    return new Response("There is no feed here.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { page, pageUrl } = result;
  const items = page.items
    .map(
      (item) => `    <item>
      <title>${xml(item.title ?? item.url)}</title>
      <link>${xml(item.url)}</link>
      <guid isPermaLink="false">${xml(`${page.handle}:${item.url}:${item.sharedAt}`)}</guid>
      <pubDate>${new Date(item.sharedAt).toUTCString()}</pubDate>
      <description>${xml(item.takeaway)}</description>
    </item>`,
    )
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(page.title)}</title>
    <link>${xml(pageUrl)}</link>
    <atom:link href="${xml(`${pageUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />
    <description>${xml(page.bio ?? `Things @${page.handle} read, and what they took from each.`)}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // Short, so taking a link off the page reaches readers soon (FR-PUB-8).
      "cache-control": "public, max-age=300",
      ...(page.indexable ? {} : { "x-robots-tag": "noindex" }),
    },
  });
}
