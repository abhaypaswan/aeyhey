// SPDX-License-Identifier: AGPL-3.0-only
// Review generated questions before they enter a deck (PRD 8.2 FR-Q-3).

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../../../lib/server";
import { ReviewQuestions } from "../../../../components/review-questions";
import { EmptyState, Page } from "../../../../components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const sourceId = (await searchParams)["source"];
  if (!sourceId) redirect("/decks");

  const { scope } = state.context;
  const decks = await repos.listDecks(scope);
  const deck = decks.find((candidate) => candidate.sourceId === sourceId);

  if (!deck) {
    return (
      <Page width="narrow">
        <EmptyState
          title="Nothing to review yet"
          body="The questions are still being written. Give it a moment and reload, or check your decks."
        />
      </Page>
    );
  }

  const pending = await repos.listQuestions(scope, {
    deckId: deck.id,
    reviewStatus: "pending_review",
  });

  // Already accepted, so there is nothing to review.
  if (pending.length === 0) redirect(`/decks/${deck.id}`);

  return <ReviewQuestions deckId={deck.id} deckName={deck.name} questions={pending} />;
}
