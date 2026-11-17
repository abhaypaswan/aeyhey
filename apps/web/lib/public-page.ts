// SPDX-License-Identifier: AGPL-3.0-only
// Reading someone's public page (PRD 28) for the web page and its RSS feed.
//
// Both go through core's publicPageByHandle, which returns only what a visitor may see,
// so nothing here can widen what is public by accident.

import { repos } from "@aeyhey/core";
import { getRuntime } from "../runtime";

export type PublicPageResult =
  | { kind: "page"; page: repos.PublicPage; pageUrl: string; publicUrl: string }
  | { kind: "moved"; handle: string }
  | { kind: "missing" };

export async function loadPublicPage(
  handle: string,
  cursor: string | null = null,
): Promise<PublicPageResult> {
  const { handle: db, env } = await getRuntime();
  const page = await repos.publicPageByHandle(db, handle, { cursor });
  if (page) {
    const publicUrl = env.PUBLIC_URL.replace(/\/+$/, "");
    return { kind: "page", page, pageUrl: `${publicUrl}/u/${page.handle}`, publicUrl };
  }
  const moved = await repos.movedHandle(db, handle);
  return moved ? { kind: "moved", handle: moved } : { kind: "missing" };
}

/** "15 Oct" this year, "15 Oct 2025" before. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
