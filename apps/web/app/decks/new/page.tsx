// SPDX-License-Identifier: AGPL-3.0-only
// /decks/new used to be a form; a deck is now made by asking the assistant on Home. This
// keeps the old address working, with any topics it was given.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const topics = params["topics"]?.trim();
  redirect(`/?say=${encodeURIComponent(topics ? topics : "Make a deck on ")}`);
}
