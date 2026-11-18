// SPDX-License-Identifier: AGPL-3.0-only
// The map: everything you keep, links and questions, drawn as one picture.
//
// Things are joined through their tags. A tag shared by two or more things becomes a hub
// that they cluster around, and a hub that holds both links and questions is a bridge
// between what you read and what you are asked. No AI is involved: the tags are already
// there, so the map costs nothing to draw and works the same self-hosted. See
// components/knowledge-map.tsx for the drawing.

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { pageState } from "../../lib/server";
import { KnowledgeMap, type MapData, type MapItem } from "../../components/knowledge-map";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope } = state.context;
  const now = new Date();

  // Every link that is still yours to read or has been read; dropped and expired ones
  // are left out, since they are not things you are keeping.
  const links: Awaited<ReturnType<typeof repos.listLinks>>["items"] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await repos.listLinks(scope, { limit: 200, ...(cursor ? { cursor } : {}) });
    links.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  const [questions, decks] = await Promise.all([
    repos.listQuestions(scope, { reviewStatus: "kept" }),
    repos.listDecks(scope, now),
  ]);
  const ids = questions.map((question) => question.id);
  const [progress, answers] = await Promise.all([
    repos.questionProgress(scope, ids, now),
    repos.lastAnswers(scope, ids),
  ]);
  const deckName = new Map(decks.map((deck) => [deck.id, deck.name]));

  const items: MapItem[] = [];
  for (const link of links) {
    if (link.status === "dropped" || link.status === "expired") continue;
    items.push({
      id: `link:${link.id}`,
      kind: "link",
      title: link.title ?? link.url,
      href: `/links/${link.id}`,
      group: link.siteName ?? new URL(link.url).host.replace(/^www\./, ""),
      tags: link.tags,
      state: link.status === "read" ? "done" : link.status === "expiring" ? "expiring" : "waiting",
      score: null,
    });
  }
  for (const question of questions) {
    const p = progress.get(question.id);
    const answer = answers.get(question.id);
    const score = answer ? answer.score : null;
    items.push({
      id: `question:${question.id}`,
      kind: "question",
      title: question.text,
      href: `/decks/${question.deckId}`,
      group: deckName.get(question.deckId) ?? "A deck",
      tags: question.tags,
      state:
        score !== null && score < 45
          ? "weak"
          : p?.state === "learned"
            ? "learned"
            : p?.state === "due"
              ? "due"
              : p?.state === "learning"
                ? "learning"
                : "new",
      score,
    });
  }

  const data: MapData = {
    items,
    decks: decks
      .filter((deck) => deck.kind !== "links" && deck.counts.total > 0)
      .map((deck) => ({ id: deck.id, name: deck.name })),
  };

  return <KnowledgeMap data={data} />;
}
