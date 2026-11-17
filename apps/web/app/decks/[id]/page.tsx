// SPDX-License-Identifier: AGPL-3.0-only
// Deck detail (PRD 12.1 screen 10).

import { notFound, redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../../lib/server";
import { DeckDetail } from "../../../components/deck-detail";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { id } = await params;
  const { scope } = state.context;

  const deck = await repos.findDeck(scope, id);
  if (!deck) notFound();

  const questions = await repos.listQuestions(scope, { deckId: id, reviewStatus: "kept" });

  return (
    <DeckDetail
      deck={{
        id: deck.id,
        name: deck.name,
        kind: deck.kind,
        hasSource: Boolean(deck.sourceId),
        paused: deck.pausedAt !== null,
      }}
      questions={questions}
    />
  );
}
