// SPDX-License-Identifier: AGPL-3.0-only
// The assistant: one box where people type or paste anything.
//
// assistant_intent reads a message the rules in assistant/rules.ts could not settle and
// says which of a few things the app should do. library_answer answers a question from
// pieces of the person's own library, and says when those pieces do not answer it.

import { INJECTION_NOTICE, joinPrompt, STYLE_NOTICE, untrusted } from "./shared";

export interface AssistantIntentInput {
  message: string;
  /** The last few turns, oldest first, so "make it harder" has something to refer to. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export const ASSISTANT_INTENT_SYSTEM = joinPrompt(
  "You are the assistant in a study app. People keep links to read later and decks of practice questions, and the app brings both back on a schedule until they know them. Read one message and decide what the app should do with it.",
  [
    "Pick one intent:",
    "- save_links: the message gives links to keep.",
    "- make_deck: they want practice questions on something: a subject, a list of topics, an exam, a book or a skill. Put the topics in topics as short names, up to 10. If they named a level (beginner, intermediate, advanced) or a purpose (learning, interviews, both), set level or style; otherwise leave them null.",
    "- ask: they asked a question about what they saved or are learning, or asked to find, list, explain or quiz them on something. Put the words to search for in query.",
    "- help: they asked about this app itself: what Aeyhey is, what it can do, or how one of its parts works (decks, sessions, cards, links, the inbox, reminders, streaks, the profile page, coding agents, search, their data).",
    "- unclear: it could reasonably be more than one of these. Ask which they meant.",
  ].join("\n"),
  "For reply, write one or two short sentences to them, in the first person, saying what you will do or asking what they meant. Do not promise anything the app cannot do.",
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

export function buildAssistantIntentPrompt(input: AssistantIntentInput): string {
  const history = (input.history ?? []).slice(-6);
  return joinPrompt(
    history.length > 0
      ? joinPrompt(
          "The conversation so far, oldest first:",
          ...history.map(
            (turn) => `${turn.role === "user" ? "They" : "You"}: ${turn.text.slice(0, 300)}`,
          ),
        )
      : null,
    "Their new message:",
    untrusted("message", input.message, 4_000),
  );
}

export interface LibraryPiece {
  /** "link:<id>" or "question:<id>", echoed back in cited. */
  id: string;
  kind: "link" | "question";
  title: string;
  text: string;
  tags: string[];
}

export interface LibraryAnswerInput {
  question: string;
  pieces: LibraryPiece[];
  /** Their weakest topics by written-answer score, for questions about how they are doing. */
  weakTopics?: { tag: string; averageScore: number }[];
}

export const LIBRARY_ANSWER_SYSTEM = joinPrompt(
  "You answer questions about what one person has saved and is learning in a study app. You are given pieces of their own library: links they saved, with summaries, and practice questions with model answers.",
  "Answer only from those pieces. When they do not answer the question, say so plainly and set found to false; do not fill the gap from general knowledge.",
  "Keep it short: a few sentences, or a short list. Name the pieces you used by their titles, so they can find them, and put their ids in cited.",
  "If they ask how they are doing or what they are weak at, use the weak topics given.",
  STYLE_NOTICE,
  INJECTION_NOTICE,
);

export function buildLibraryAnswerPrompt(input: LibraryAnswerInput): string {
  const pieces = input.pieces
    .map(
      (piece) =>
        `[${piece.id}] ${piece.kind === "link" ? "Saved link" : "Practice question"}: ${piece.title}\nTags: ${piece.tags.join(", ") || "none"}\n${piece.text}`,
    )
    .join("\n\n");
  const weak = (input.weakTopics ?? [])
    .slice(0, 6)
    .map((topic) => `${topic.tag}: ${topic.averageScore} out of 100`)
    .join("\n");
  return joinPrompt(
    "Their question:",
    untrusted("message", input.question, 1_000),
    pieces
      ? joinPrompt("Pieces of their library:", untrusted("library", pieces, 14_000))
      : "Nothing in their library matched.",
    weak ? joinPrompt("Their weakest topics, by average score on written answers:", weak) : null,
  );
}
