// SPDX-License-Identifier: AGPL-3.0-only
// The assistant: one message in, the right thing done, and a reply.
//
// Every way of adding to Aeyhey or asking about it goes through here. Links are saved at
// once, since a link is never ambiguous. A deck is proposed first, with its topics, level
// and purpose, so nothing is written (and nothing is spent) until the person agrees. A
// question is answered from their own library, with the pieces it used, and a question
// about Aeyhey itself from the app's own help (help.ts). When a message
// could mean more than one thing, the reply asks, with a button for each reading.
//
// The rules in rules.ts settle the easy cases without a model. A model is asked only when
// they are unsure, and if there is no model, or it fails, the rules' reading stands, so
// the assistant still works on an instance with no AI set up.

import { callAi, type AiCallDeps } from "../ai/call";
import {
  ASSISTANT_INTENT_SYSTEM,
  LIBRARY_ANSWER_SYSTEM,
  buildAssistantIntentPrompt,
  buildLibraryAnswerPrompt,
} from "../ai/prompts/index";
import type { AssistantIntentOutput } from "../ai/contracts/index";
import type { Scope } from "../repos/context";
import { loadStats } from "../repos/stats";
import { createLogger } from "../logger";
import { findHelp, HELP_ARTICLES, isAboutApp } from "./help";
import { readMessage } from "./rules";
import { searchLibrary, type LibraryHit } from "./search";

const log = createLogger("assistant");

export type AssistantIntent = AssistantIntentOutput["intent"];

export interface AssistantInput {
  message: string;
  /** Set by a button that already says what was meant, such as "Make a deck on this". */
  force?: "save_links" | "make_deck" | "ask";
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface DeckProposal {
  topics: string[];
  level: "beginner" | "intermediate" | "advanced";
  style: "study" | "interview" | "mixed";
  countPerTopic: number;
}

export interface AssistantReply {
  intent: AssistantIntent;
  reply: string;
  saved?: { created: number; duplicates: number; links: { id: string; url: string }[] };
  proposal?: DeckProposal;
  answer?: {
    found: boolean;
    sources: { id: string; kind: "link" | "question"; title: string; href: string }[];
  };
  /** Ways to carry on, each a message to send again with its intent settled. */
  options?: { label: string; message: string; force: "make_deck" | "ask" }[];
}

export interface AssistantDeps {
  ai: AiCallDeps;
  /** Saves the links in a message and queues them to be read, as the add links route does. */
  saveLinks: (text: string) => Promise<{
    created: { id: string; url: string }[];
    duplicates: unknown[];
  }>;
}

function forced(
  input: AssistantInput,
  rules: ReturnType<typeof readMessage>,
): AssistantIntentOutput {
  const message = input.message.trim();
  if (input.force === "make_deck") {
    const topics =
      rules.intent === "make_deck" || rules.intent === "unclear"
        ? rules.topics
        : [message.slice(0, 80)];
    return { ...rules, intent: "make_deck", topics, reply: "" };
  }
  if (input.force === "ask") {
    return { ...rules, intent: "ask", query: rules.query || message, reply: "" };
  }
  return { ...rules, intent: "save_links", reply: "" };
}

/** The rules' reading, or a model's when the rules are unsure and a model is there. */
async function understand(
  scope: Scope,
  deps: AssistantDeps,
  input: AssistantInput,
): Promise<AssistantIntentOutput> {
  const rules = readMessage(input.message);
  if (input.force) return forced(input, rules);
  if (rules.sure) return rules;
  try {
    const result = await callAi(deps.ai, {
      contract: "assistant_intent",
      userId: scope.userId,
      system: ASSISTANT_INTENT_SYSTEM,
      prompt: buildAssistantIntentPrompt({
        message: input.message,
        ...(input.history ? { history: input.history } : {}),
      }),
    });
    // A model never gets to save links the rules did not see: that path stays mechanical.
    if (result.object.intent === "save_links" && rules.intent !== "save_links") return rules;
    return result.object;
  } catch (error) {
    log.info("no model reading for a message, using the rules", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return rules;
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function answerFromLibrary(
  scope: Scope,
  deps: AssistantDeps,
  question: string,
  query: string,
): Promise<AssistantReply> {
  const hits = await searchLibrary(scope, query || question);
  const stats = await loadStats(scope);
  const weakTopics = [...stats.scoreByTag]
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 6)
    .map((row) => ({ tag: row.tag, averageScore: row.averageScore }));
  const asksAboutProgress = /\b(weak|strong|struggl|progress|doing|score|worst|best)\w*/i.test(
    question,
  );

  const sourcesOf = (list: LibraryHit[]) =>
    list.map((hit) => ({ id: hit.id, kind: hit.kind, title: hit.title, href: hit.href }));

  if (hits.length === 0 && !(asksAboutProgress && weakTopics.length > 0)) {
    // Nothing saved answers it, but it may be about the app: a model can read "what does
    // this thing do" as a library question.
    if (isAboutApp(question)) return helpReply(question);
    return {
      intent: "ask",
      reply: "I could not find anything about that in what you have saved.",
      answer: { found: false, sources: [] },
      options: [
        {
          label: "Make a deck on it instead",
          message: question,
          force: "make_deck",
        },
      ],
    };
  }

  try {
    const result = await callAi(deps.ai, {
      contract: "library_answer",
      userId: scope.userId,
      system: LIBRARY_ANSWER_SYSTEM,
      prompt: buildLibraryAnswerPrompt({
        question,
        pieces: hits.map((hit) => ({
          id: hit.id,
          kind: hit.kind,
          title: hit.title,
          text: hit.text,
          tags: hit.tags,
        })),
        ...(asksAboutProgress ? { weakTopics } : {}),
      }),
    });
    const cited = new Set(result.object.cited);
    const used = hits.filter((hit) => cited.has(hit.id));
    return {
      intent: "ask",
      reply: result.object.answer,
      answer: {
        found: result.object.found,
        sources: sourcesOf(result.object.found ? (used.length > 0 ? used : hits.slice(0, 3)) : []),
      },
    };
  } catch (error) {
    // No model, or it failed: what was found is still worth showing.
    log.info("no model answer, listing what was found", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return {
      intent: "ask",
      reply:
        hits.length > 0
          ? `I found ${plural(hits.length, "thing")} in your library about that:`
          : "Your weakest topics so far are " +
            weakTopics.map((topic) => `${topic.tag} (${topic.averageScore})`).join(", ") +
            ".",
      answer: { found: hits.length > 0, sources: sourcesOf(hits.slice(0, 6)) },
    };
  }
}

/** An answer about Aeyhey itself, from its own help. */
function helpReply(message: string): AssistantReply {
  const article = findHelp(message) ?? HELP_ARTICLES[0]!;
  return { intent: "help", reply: article.answer };
}

export async function respond(
  scope: Scope,
  deps: AssistantDeps,
  input: AssistantInput,
): Promise<AssistantReply> {
  const reading = await understand(scope, deps, input);
  const message = input.message.trim();

  switch (reading.intent) {
    case "save_links": {
      const result = await deps.saveLinks(message);
      const created = result.created.length;
      const duplicates = result.duplicates.length;
      const reply =
        created === 0 && duplicates === 0
          ? "I could not find a link in that. Paste the whole address, starting with https."
          : created === 0
            ? duplicates === 1
              ? "You already saved that one."
              : `You already saved all ${duplicates} of those.`
            : `Saved ${plural(created, "link")}${duplicates > 0 ? `, and ${duplicates} you already had` : ""}. I am reading ${created === 1 ? "it" : "them"} now and will write a short summary of each.`;
      return {
        intent: "save_links",
        reply,
        saved: { created, duplicates, links: result.created },
      };
    }

    case "make_deck": {
      const topics = [
        ...new Set(reading.topics.map((topic) => topic.trim()).filter(Boolean)),
      ].slice(0, 10);
      if (topics.length === 0) {
        return {
          intent: "unclear",
          reply: "What would you like questions on? A few topics, or a subject, is enough.",
        };
      }
      const proposal: DeckProposal = {
        topics,
        level: reading.level ?? "intermediate",
        style: reading.style ?? "study",
        countPerTopic: 5,
      };
      return {
        intent: "make_deck",
        reply:
          reading.reply && !input.force
            ? reading.reply
            : `I will make a deck on ${topics.length === 1 ? topics[0] : plural(topics.length, "topic")}.`,
        proposal,
      };
    }

    case "ask":
      return answerFromLibrary(scope, deps, message, reading.query);

    case "help":
      return helpReply(message);

    case "unclear":
    default:
      return {
        intent: "unclear",
        reply:
          reading.reply ||
          "Do you want questions on that, or to find what you have saved about it?",
        options: [
          { label: "Make a deck on it", message, force: "make_deck" },
          { label: "Find it in my library", message, force: "ask" },
        ],
      };
  }
}
