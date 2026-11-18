// SPDX-License-Identifier: AGPL-3.0-only
// Searching one person's library: their links and their practice questions.
//
// The assistant answers questions from this, so it has to find the right few pieces and
// rank them, the same way on SQLite and on Postgres. It is a word search: each meaningful
// word of the question is looked for in titles, summaries, notes, the saved page text,
// questions, model answers and tags, and a piece scores by where its words were found.
// A piece must have at least half of the words to count, so one shared word is not a
// match. A personal library is small enough that the ranking runs here rather than in the
// database, which keeps the two databases behaving the same. Every query is scoped to
// the one user.

import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Scope } from "../repos/context";
import { tagsForItems } from "../repos/tags";
import { searchWords } from "./rules";

export interface LibraryHit {
  /** "link:<id>" or "question:<id>". */
  id: string;
  kind: "link" | "question";
  itemId: string;
  title: string;
  /** What the answer is written from: a summary, or a question with its model answer. */
  text: string;
  tags: string[];
  href: string;
  score: number;
  /** How many of the question's words the piece has. */
  matched: number;
}

const CANDIDATES = 300;

function anyWord(column: SQL, words: string[]): SQL {
  return or(...words.map((word) => sql`lower(${column}) like ${`%${word}%`}`))!;
}

function count(haystack: string | null | undefined, words: string[]): number {
  if (!haystack) return 0;
  const lower = haystack.toLowerCase();
  return words.filter((word) => lower.includes(word)).length;
}

/** How many of the words appear anywhere in the piece. */
function covered(haystacks: (string | null | undefined)[], words: string[]): number {
  const all = haystacks.filter(Boolean).join(" ").toLowerCase();
  return words.filter((word) => all.includes(word)).length;
}

export async function searchLibrary(
  scope: Scope,
  question: string,
  limit = 8,
): Promise<LibraryHit[]> {
  const words = searchWords(question);
  if (words.length === 0) return [];

  const { links, questions, tags, itemTags } = scope.handle.schema;
  const summaryText = sql`cast(${links.summaryLines} as text)`;
  const pageText = sql`substr(${links.extractedText}, 1, 20000)`;

  // Things tagged with one of the words count even when the words appear nowhere else.
  const tagRows = await scope.handle.db
    .select({ itemType: itemTags.itemType, itemId: itemTags.itemId, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(and(eq(tags.userId, scope.userId), anyWord(sql`${tags.name}`, words)));
  const taggedLinks = tagRows.filter((row) => row.itemType === "link").map((row) => row.itemId);
  const taggedQuestions = tagRows
    .filter((row) => row.itemType === "question")
    .map((row) => row.itemId);

  const linkRows = await scope.handle.db
    .select({
      id: links.id,
      title: links.title,
      url: links.url,
      summaryLines: links.summaryLines,
      whySaved: links.whySaved,
      userNote: links.userNote,
      page: pageText,
    })
    .from(links)
    .where(
      and(
        eq(links.userId, scope.userId),
        ne(links.status, "dropped"),
        or(
          anyWord(sql`${links.title}`, words),
          anyWord(summaryText, words),
          anyWord(sql`${links.whySaved}`, words),
          anyWord(sql`${links.userNote}`, words),
          anyWord(pageText, words),
          taggedLinks.length > 0 ? inArray(links.id, taggedLinks) : sql`1 = 0`,
        ),
      ),
    )
    .limit(CANDIDATES);

  const questionRows = await scope.handle.db
    .select({
      id: questions.id,
      deckId: questions.deckId,
      text: questions.text,
      modelAnswer: questions.modelAnswer,
    })
    .from(questions)
    .where(
      and(
        eq(questions.userId, scope.userId),
        eq(questions.reviewStatus, "kept"),
        or(
          anyWord(sql`${questions.text}`, words),
          anyWord(sql`${questions.modelAnswer}`, words),
          taggedQuestions.length > 0 ? inArray(questions.id, taggedQuestions) : sql`1 = 0`,
        ),
      ),
    )
    .limit(CANDIDATES);

  const [linkTags, questionTags] = await Promise.all([
    tagsForItems(
      scope,
      "link",
      linkRows.map((row) => row.id),
    ),
    tagsForItems(
      scope,
      "question",
      questionRows.map((row) => row.id),
    ),
  ]);

  const hits: LibraryHit[] = [];
  for (const row of linkRows) {
    const summary = (row.summaryLines as string[] | null)?.join(" ") ?? "";
    const itemTagList = linkTags.get(row.id) ?? [];
    const score =
      3 * count(row.title, words) +
      3 * count(itemTagList.join(" "), words) +
      2 * count(summary, words) +
      2 * count(row.whySaved, words) +
      2 * count(row.userNote, words) +
      1 * count(row.page as string | null, words);
    hits.push({
      id: `link:${row.id}`,
      kind: "link",
      itemId: row.id,
      title: row.title ?? row.url,
      text: [summary, row.whySaved, row.userNote ? `Their note: ${row.userNote}` : null]
        .filter(Boolean)
        .join(" ")
        .slice(0, 700),
      tags: itemTagList,
      href: `/links/${row.id}`,
      score,
      matched: covered(
        [
          row.title,
          itemTagList.join(" "),
          summary,
          row.whySaved,
          row.userNote,
          row.page as string | null,
        ],
        words,
      ),
    });
  }
  for (const row of questionRows) {
    const itemTagList = questionTags.get(row.id) ?? [];
    const score =
      3 * count(row.text, words) +
      3 * count(itemTagList.join(" "), words) +
      1 * count(row.modelAnswer, words);
    hits.push({
      id: `question:${row.id}`,
      kind: "question",
      itemId: row.id,
      title: row.text,
      text: `Model answer: ${row.modelAnswer}`.slice(0, 700),
      tags: itemTagList,
      href: `/decks/${row.deckId}`,
      score,
      matched: covered([row.text, itemTagList.join(" "), row.modelAnswer], words),
    });
  }

  // A piece has to have at least half of the question's words: "reverse binary tree"
  // should not turn up a note on b-trees because it says "tree".
  const needed = Math.max(1, Math.ceil(words.length / 2));
  return hits
    .filter((hit) => hit.score > 0 && hit.matched >= needed)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
