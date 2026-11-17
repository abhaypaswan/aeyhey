// SPDX-License-Identifier: AGPL-3.0-only
// One deck, as the phone app has it. The same numbers GET /api/decks/{id} returns, read
// here directly so the page and the app agree. See components/deck-detail.tsx.

import { notFound, redirect } from "next/navigation";
import { repos, scheduler } from "@aeyhey/core";
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

  const now = new Date();
  const cadence = repos.toCadenceSettings(await repos.loadSettings(scope));
  const writes = deck.sourceId !== null && deck.kind !== "manual" && deck.kind !== "links";
  const remindersOn = !scheduler.isPaused(now, cadence);

  const kept = await repos.listQuestions(scope, { deckId: id, reviewStatus: "kept" });
  const ids = kept.map((question) => question.id);
  const [progress, answers, topics, listed] = await Promise.all([
    repos.questionProgress(scope, ids, now),
    repos.lastAnswers(scope, ids),
    repos.deckTopics(scope, deck),
    repos.listDecks(scope, now),
  ]);
  const counts = listed.find((row) => row.id === id)?.counts ?? null;

  // Not asked yet first, newest on top, then by when each was last asked.
  const questions = kept
    .map((question) => {
      const p = progress.get(question.id) ?? null;
      const answer = answers.get(question.id) ?? null;
      return {
        id: question.id,
        text: question.text,
        modelAnswer: question.modelAnswer,
        keyPoints: question.keyPoints,
        difficulty: question.difficulty,
        tags: question.tags,
        position: question.position,
        state: p?.state ?? null,
        timesAsked: p?.timesAsked ?? 0,
        lastAskedAt: p?.lastAskedAt ? p.lastAskedAt.getTime() : null,
        lastAnswer: answer ? { text: answer.text, verdict: answer.verdict } : null,
      };
    })
    .sort((a, b) => {
      if (a.lastAskedAt === null && b.lastAskedAt === null) return b.position - a.position;
      if (a.lastAskedAt === null) return -1;
      if (b.lastAskedAt === null) return 1;
      return b.lastAskedAt - a.lastAskedAt;
    });

  return (
    <DeckDetail
      deck={{
        id: deck.id,
        name: deck.name,
        kind: deck.kind,
        paused: deck.pausedAt !== null,
        writes,
        remindersOn,
        nextQuestionsLabel:
          writes && remindersOn ? scheduler.describeNextSession(now, cadence) : null,
        total: counts?.total ?? kept.length,
        due: counts?.due ?? 0,
        dueNew: counts?.dueNew ?? 0,
        dueReview: counts?.dueReview ?? 0,
        learned: counts?.learned ?? 0,
        unasked: questions.filter((question) => question.state === "new").length,
      }}
      topics={topics.topics}
      questions={questions}
    />
  );
}
