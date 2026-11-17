// SPDX-License-Identifier: AGPL-3.0-only
// New deck (PRD 12.1 screens 8 and 9).

import { redirect } from "next/navigation";
import { pageState } from "../../../lib/server";
import { NewDeckForm } from "../../../components/new-deck-form";

export const dynamic = "force-dynamic";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const params = await searchParams;
  return <NewDeckForm mode={params["from"] === "resume" ? "resume" : "topics"} />;
}
