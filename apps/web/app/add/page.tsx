// SPDX-License-Identifier: AGPL-3.0-only
// Add links (PRD 12.1 screen 6, 8.1 FR-LINK-1).

import { redirect } from "next/navigation";
import { pageState } from "../../lib/server";
import { AddLinksForm } from "../../components/add-links-form";

export const dynamic = "force-dynamic";

export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const params = await searchParams;
  return <AddLinksForm prefill={params["url"] ?? ""} shared={params["shared"] ?? null} />;
}
