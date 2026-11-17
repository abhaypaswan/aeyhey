// SPDX-License-Identifier: AGPL-3.0-only
// The inbox (PRD 12.1 screen 4, 8.1 FR-LINK-8).

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { InboxView } from "../../components/inbox-view";

export const dynamic = "force-dynamic";

const STATUSES = ["unread", "snoozed", "read", "dropped", "expiring", "expired"] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const params = await searchParams;
  const status = STATUSES.includes(params["status"] as never)
    ? (params["status"] as (typeof STATUSES)[number])
    : undefined;

  const { scope } = state.context;
  const [page, counts, tags] = await Promise.all([
    repos.listLinks(scope, {
      ...(status ? { status } : {}),
      ...(params["tag"] ? { tag: params["tag"] } : {}),
      ...(params["q"] ? { q: params["q"] } : {}),
      limit: 50,
    }),
    repos.linkCounts(scope),
    repos.listTags(scope),
  ]);

  return (
    <InboxView
      initialItems={page.items.map((item) => ({
        ...item,
        savedAt: item.savedAt.toISOString(),
        due: item.due ? item.due.toISOString() : null,
      }))}
      nextCursor={page.nextCursor}
      counts={counts}
      tags={tags.map((tag) => tag.name)}
      activeStatus={status ?? null}
      activeTag={params["tag"] ?? null}
      query={params["q"] ?? ""}
    />
  );
}
