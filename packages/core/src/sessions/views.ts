// SPDX-License-Identifier: AGPL-3.0-only
// What the session view sends to the client (PRD Appendix A).
//
// The important thing this file does is decide what the client is NOT told. A question's
// model answer is not in the payload until the user reveals it, answers it, or says they
// do not know. Sending it with the card would put the answer in the network tab of the
// page that is asking the question.

import { and, eq, inArray } from "drizzle-orm";
import type { Difficulty, QuestionCategory } from "../db/types";
import type { Scope } from "../repos/context";
import { tagsForItems } from "../repos/tags";

export interface LinkCardView {
  kind: "link";
  cardId: string;
  linkId: string;
  title: string;
  url: string;
  siteName?: string;
  faviconUrl?: string;
  imageUrl?: string;
  summaryLines?: [string, string, string];
  whySaved?: string;
  summaryConfidence?: "high" | "low";
  tags: string[];
  note?: string;
  readMinutes?: number;
  savedAt: string;
  status: "unread" | "snoozed" | "expiring";
  /** True for a link on its final showing, which the UI labels "Last chance". */
  lastChance: boolean;
}

export interface QuestionCardView {
  kind: "question";
  cardId: string;
  questionId: string;
  text: string;
  tags: string[];
  difficulty: Difficulty;
  category: QuestionCategory;
  /** "From your resume" or the topic name. */
  sourceLabel: string;
  isNew: boolean;
  // No modelAnswer here, on purpose. See the note at the top of this file.
}

export type CardView = LinkCardView | QuestionCardView;

function faviconFor(url: string): string | undefined {
  try {
    const { protocol, host } = new URL(url);
    // The site's own favicon, fetched by the browser from the site itself. No third party
    // favicon service, because that would tell someone else what the user saved.
    return `${protocol}//${host}/favicon.ico`;
  } catch {
    return undefined;
  }
}

/** Loads the view payloads for a set of cards, in the order given. */
export async function loadCardViews(scope: Scope, cardIds: readonly string[]): Promise<CardView[]> {
  if (cardIds.length === 0) return [];

  const { cards, links, questions, decks, questionSources } = scope.handle.schema;

  const rows = await scope.handle.db
    .select({
      card: cards,
      link: links,
      question: questions,
      deckName: decks.name,
      deckKind: decks.kind,
      sourceTopics: questionSources.topics,
    })
    .from(cards)
    .leftJoin(links, and(eq(cards.itemType, "link"), eq(links.id, cards.itemId)))
    .leftJoin(questions, and(eq(cards.itemType, "question"), eq(questions.id, cards.itemId)))
    .leftJoin(decks, eq(decks.id, questions.deckId))
    .leftJoin(questionSources, eq(questionSources.id, decks.sourceId))
    .where(and(eq(cards.userId, scope.userId), inArray(cards.id, [...cardIds])));

  const linkIds = rows.filter((r) => r.link).map((r) => r.link!.id);
  const questionIds = rows.filter((r) => r.question).map((r) => r.question!.id);
  const linkTags = await tagsForItems(scope, "link", linkIds);
  const questionTags = await tagsForItems(scope, "question", questionIds);

  const byCardId = new Map<string, CardView>();

  for (const row of rows) {
    if (row.link) {
      const link = row.link;
      byCardId.set(row.card.id, {
        kind: "link",
        cardId: row.card.id,
        linkId: link.id,
        // A link with no title still needs something to show, so the URL stands in.
        title: link.title ?? link.url,
        url: link.url,
        ...(link.siteName ? { siteName: link.siteName } : {}),
        ...(faviconFor(link.url) ? { faviconUrl: faviconFor(link.url)! } : {}),
        ...(link.imageUrl ? { imageUrl: link.imageUrl } : {}),
        ...(link.summaryLines ? { summaryLines: link.summaryLines } : {}),
        ...(link.whySaved ? { whySaved: link.whySaved } : {}),
        ...(link.summaryConfidence ? { summaryConfidence: link.summaryConfidence } : {}),
        tags: linkTags.get(link.id) ?? [],
        ...(link.userNote ? { note: link.userNote } : {}),
        ...(link.readMinutes ? { readMinutes: link.readMinutes } : {}),
        savedAt: link.savedAt.toISOString(),
        status: (link.status === "expiring"
          ? "expiring"
          : link.status === "snoozed"
            ? "snoozed"
            : "unread") as LinkCardView["status"],
        lastChance: link.status === "expiring",
      });
      continue;
    }

    if (row.question) {
      const question = row.question;
      const sourceLabel =
        row.deckKind === "resume"
          ? "From your resume"
          : (row.sourceTopics?.[0] ?? row.deckName ?? "Your deck");

      byCardId.set(row.card.id, {
        kind: "question",
        cardId: row.card.id,
        questionId: question.id,
        text: question.text,
        tags: questionTags.get(question.id) ?? [],
        difficulty: question.difficulty,
        category: question.category,
        sourceLabel,
        isNew: row.card.status === "new" || row.card.reps === 0,
      });
    }
  }

  // The session builder's order is the order the user sees, so it is preserved here.
  return cardIds
    .map((id) => byCardId.get(id))
    .filter((view): view is CardView => view !== undefined);
}
