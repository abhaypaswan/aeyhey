// SPDX-License-Identifier: AGPL-3.0-only
// Someone's public reading profile (PRD 28): who they are, how steadily they read, what
// about, and what they took from each thing. Laid out for a phone first; on a wide
// screen the person moves into a column on the left.
//
// Server-rendered; the share button is the only client JavaScript. Off and missing pages
// look the same: a 404.

import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import type { repos } from "@aeyhey/core";
import { loadPublicPage } from "../../../lib/public-page";
import { PublicPageView } from "./view";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function cursorFrom(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length < 200 ? value : null;
}

function describe(page: repos.PublicPage): string {
  if (page.bio) return page.bio;
  const stats = page.stats;
  if (stats && stats.takeaways > 0) {
    return `${stats.linksRead} links read, ${stats.takeaways} takeaways shared, a ${stats.longestStreak}-day best streak.`;
  }
  return `What @${page.handle} reads, and the one thing they take from each.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const result = await loadPublicPage(handle);
  if (result.kind !== "page") return { title: "Not found", robots: { index: false } };

  const { page, pageUrl } = result;
  const description = describe(page);
  const title = page.name ? `${page.name} (@${page.handle})` : page.title;
  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      types: { "application/rss+xml": `${pageUrl}/rss.xml` },
    },
    openGraph: { title, description, url: pageUrl, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
    robots: page.indexable ? { index: true, follow: false } : { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params, searchParams }: Props) {
  const { handle } = await params;
  const cursor = cursorFrom((await searchParams)["cursor"]);
  const result = await loadPublicPage(handle, cursor);

  if (result.kind === "moved") permanentRedirect(`/u/${result.handle}`);
  if (result.kind === "missing") notFound();

  const { page, pageUrl } = result;
  return <PublicPageView page={page} pageUrl={pageUrl} />;
}
