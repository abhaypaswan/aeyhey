// SPDX-License-Identifier: AGPL-3.0-only
// /add used to be a page of its own; adding now happens in the assistant on Home. This
// keeps the old address working for the share target, the bookmarklet and old links.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  // The share target saves the link itself before it sends anyone here.
  if (params["shared"]) redirect("/inbox");
  const url = params["url"]?.trim();
  redirect(url ? `/?say=${encodeURIComponent(url)}` : "/");
}
