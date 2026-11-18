// SPDX-License-Identifier: AGPL-3.0-only
// Reading a message to the assistant without a model.
//
// Most messages say plainly what they are: a link is a link, a line ending in a question
// mark is a question, "Kafka, Raft, consensus" is a list of topics. Those are decided
// here, for free, before any model is asked. The same rules are the whole answer when no
// AI provider is set up, and they are what the mock provider answers with, so demo mode
// and the tests behave like the real thing on the easy cases.

import type { AssistantIntentOutput } from "../ai/contracts/index";
import { extractUrls } from "../links/extract-urls";
import { isAboutApp } from "./help";

const QUESTION_START =
  /^(what|whats|what's|how|why|which|when|where|who|whom|whose|is|are|am|do|does|did|can|could|should|would|will|have|has|explain|tell|show|list|find|quiz|summari[sz]e|remind|give)\b/i;

/** Words that carry no meaning for a search. */
const STOP = new Set(
  (
    "a an the and or but of to in on at for with about from by as is are was were be been " +
    "it its this that these those i me my we our you your they them what which who how why " +
    "when where do does did can could should would will have has had any some all saved save " +
    "read reading learn learning tell show find list explain quiz about know thing things " +
    "anything something did i've ive have there their please give me more"
  ).split(" "),
);

/** The words worth searching a library for, from a question. */
export function searchWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\- ]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP.has(word));
  return [...new Set(words)].slice(0, 8);
}

function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  return /\?\s*$/.test(trimmed) || QUESTION_START.test(trimmed);
}

/** Splits "Kafka, Raft and consensus" into its topics, or returns null if it is not a list. */
function topicList(text: string): string[] | null {
  const parts = text
    .split(/,|;|\n|\band\b|&/i)
    .map((part) => part.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 10) return null;
  if (parts.some((part) => part.split(/\s+/).length > 6)) return null;
  return parts;
}

/**
 * The rule-based reading of a message. `sure` is false when the rules are guessing and a
 * model, if there is one, should decide instead.
 */
export function readMessage(text: string): AssistantIntentOutput & { sure: boolean } {
  const message = text.trim();
  const urls = extractUrls(message).urls;
  const leftover = message.replace(/\S*(?:https?:\/\/|www\.)\S+/gi, " ").trim();

  // Links, perhaps with a few words of their own: keep them.
  if (urls.length > 0 && leftover.split(/\s+/).filter(Boolean).length <= 12) {
    return {
      intent: "save_links",
      reply:
        urls.length === 1
          ? "Saving that link. I will read it and write a short summary."
          : `Saving ${urls.length} links. I will read each one and write a short summary.`,
      topics: [],
      level: null,
      style: null,
      query: "",
      sure: true,
    };
  }

  // A question about Aeyhey itself: answered from the app's own help, not the library.
  if (isAboutApp(message)) {
    return {
      intent: "help",
      reply: "",
      topics: [],
      level: null,
      style: null,
      query: "",
      sure: true,
    };
  }

  if (looksLikeQuestion(message)) {
    return {
      intent: "ask",
      reply: "Let me look through what you have saved.",
      topics: [],
      level: null,
      style: null,
      query: searchWords(message).join(" "),
      sure: /\?\s*$/.test(message),
    };
  }

  const topics = topicList(message);
  if (topics) {
    return {
      intent: "make_deck",
      reply: `I can make a deck on ${topics.length} topics.`,
      topics,
      level: null,
      style: null,
      query: "",
      sure: true,
    };
  }

  // A short phrase on its own could be a topic to learn or a search: ask.
  const words = message.split(/\s+/).filter(Boolean);
  if (words.length <= 6) {
    return {
      intent: "unclear",
      reply: `Do you want questions on "${message}", or to find what you have saved about it?`,
      topics: [message],
      level: null,
      style: null,
      query: searchWords(message).join(" ") || message,
      sure: false,
    };
  }

  // Anything longer is most likely a description of what they want to learn.
  return {
    intent: "make_deck",
    reply: "I can make a deck from that.",
    topics: [message.slice(0, 80)],
    level: null,
    style: null,
    query: "",
    sure: false,
  };
}
