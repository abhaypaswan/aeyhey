// SPDX-License-Identifier: AGPL-3.0-only
// What the assistant knows about Aeyhey itself.
//
// Questions about the app ("what is a deck?", "what can Aeyhey do?") are not about the
// person's library, so searching it finds nothing. They are answered from these short
// articles instead: written once, true to how the app works, and free to serve, so the
// answer is the same with or without an AI provider.

import { searchWords } from "./rules";

export interface HelpArticle {
  id: string;
  title: string;
  /** Words that point at this article. Matched as whole words, singular or plural. */
  keywords: string[];
  answer: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "overview",
    title: "What Aeyhey is",
    keywords: ["aeyhey", "app", "purpose", "point", "use", "work", "works", "about", "start"],
    answer:
      "Aeyhey helps you remember what you read and learn. Save links you mean to read, or tell me what you want to learn and I make a deck of practice questions on it, from topics, a book, your notes or your resume. Then a short session each day brings back a few cards at a time, timed for just before you would forget them, until you know them.",
  },
  {
    id: "aey",
    title: "aey",
    keywords: ["aey", "you", "who", "name", "assistant", "chat", "bot"],
    answer:
      "I am aey, the one you talk to in Aeyhey. Paste a link and I save it, name a topic or attach a book, your notes or your resume and I make a deck of practice questions, or ask me anything and I answer, from your own library when it covers it.",
  },
  {
    id: "deck",
    title: "Decks",
    keywords: ["deck", "decks", "question", "questions", "topic", "topics", "practice"],
    answer:
      'A deck is a set of practice questions on one subject. Name a few topics here, like "The solar system, stars and black holes", or attach a book, notes or your resume, and I write the questions with model answers. You answer in your own words, I score the answer, and each question comes back on its own schedule. Your decks are on Home.',
  },
  {
    id: "session",
    title: "Sessions and cards",
    keywords: [
      "session",
      "sessions",
      "card",
      "cards",
      "review",
      "reviews",
      "schedule",
      "forget",
      "spaced",
      "repetition",
      "rating",
    ],
    answer:
      "A session is a few cards, one at a time: links waiting to be read and questions that are due. Each answer or action decides when that card comes back. Ones you know well come back after longer and longer gaps; ones you struggle with come back sooner. Start one from Home with Start session.",
  },
  {
    id: "links",
    title: "Links and the Inbox",
    keywords: [
      "link",
      "links",
      "inbox",
      "save",
      "summary",
      "summaries",
      "snooze",
      "snoozed",
      "chance",
      "expire",
      "expired",
      "expiring",
      "read",
    ],
    answer:
      "Paste a link here and I save it, read it and write a short summary. Links wait in your Inbox and turn up in sessions until you read them. Snooze one and it comes back later. A link you keep snoozing or skipping, or leave unread for months, gets one last showing marked Last chance and then expires. Nothing is deleted: expired links stay in the Inbox and can be brought back.",
  },
  {
    id: "reminders",
    title: "Reminders",
    keywords: [
      "reminder",
      "reminders",
      "notification",
      "notifications",
      "notify",
      "email",
      "telegram",
      "push",
      "pause",
    ],
    answer:
      "Aeyhey reminds you when a session is ready, at the time you choose, by browser or phone notification, email or Telegram. Change the time, how many cards a session has, or pause reminders from the menu behind your picture, or in Settings.",
  },
  {
    id: "streak",
    title: "Streaks and stats",
    keywords: ["streak", "streaks", "stats", "statistics", "progress", "accuracy", "week"],
    answer:
      "Your streak counts the days in a row you did a session. Stats, in the menu behind your picture, shows your week, how well you answer and your streak.",
  },
  {
    id: "profile",
    title: "Profile",
    keywords: ["profile", "public", "page", "share", "takeaway", "takeaways", "handle", "hidden"],
    answer:
      "Profile is your public page: what you learned from what you read, each with the one thing you took from it, and optionally your stats, your work and what you built. Nothing goes on it by itself except coding highlights you turned on. Switch it to Public to share the link, or keep it hidden.",
  },
  {
    id: "agents",
    title: "Coding agents",
    keywords: [
      "agent",
      "agents",
      "coding",
      "claude",
      "codex",
      "mcp",
      "highlight",
      "highlights",
      "built",
      "building",
    ],
    answer:
      "Connect a coding agent such as Claude Code in Settings, under Agents, and it reports each finished session to Aeyhey. Once a day I write a short summary of what you built. It shows on your Profile only if you turn that on; the session logs themselves never show.",
  },
  {
    id: "search",
    title: "Search and the map",
    keywords: ["search", "find", "map", "graph", "canvas", "cluster", "connections"],
    answer:
      "Search, at the top or with Cmd K, finds anything you saved. The map on Home draws your links and questions grouped by subject, and shows where your reading and your decks meet.",
  },
  {
    id: "data",
    title: "Your data",
    keywords: [
      "data",
      "export",
      "import",
      "delete",
      "account",
      "privacy",
      "private",
      "open",
      "source",
      "self",
      "host",
    ],
    answer:
      "Your library is yours. Export it from Settings, under Data, and delete your account there too. Aeyhey is open source, so you can also run it yourself.",
  },
];

/** Words that say a question is about the app rather than about what was saved. */
// aey, always lowercase, is the name of the one you talk to, so a question to it about
// itself is about the app too.
const APP_WORDS =
  /\b(aeyhey|aey|this app|the app|this site|this website|who are you|what are you|what can you do|your name)\b/i;

/** "What did I save about decks" is a library question, even though it says decks. */
const ABOUT_MY_LIBRARY =
  /\b(i|i've|ive)\s+(save|saved|read|learn|learned|learnt|added|kept|bookmarked)\b|\bmy (library|links|notes|saved)\b/i;

/** Everyday verbs around the app's own words: "how do I make a deck?". */
const ACTIONS = (
  "make create add new change edit set turn get remove stop last mean means meant " +
  "connect share work works happen happens"
).split(" ");

/** How people ask how something works. */
const HOW_IT_WORKS =
  /^(what('?s| is| are| does| do| happens)|how (do|does|can|to|is|are)|why (do|does|is|are|did)|can (i|you)|where (is|are|do)|explain|tell me about|help)\b/i;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function score(article: HelpArticle, list: string[]): number {
  let total = 0;
  for (const word of list) {
    const singular = word.endsWith("s") ? word.slice(0, -1) : word;
    if (article.keywords.includes(word) || article.keywords.includes(singular)) total += 1;
  }
  return total;
}

/** The article that best answers a question, or null when none fits. */
export function findHelp(text: string): HelpArticle | null {
  const list = words(text);
  let best: HelpArticle | null = null;
  let bestScore = 0;
  for (const article of HELP_ARTICLES) {
    // The overview's words are general ("app", "use"), so a specific article wins a tie:
    // "what is a deck in aeyhey" is about decks.
    const value = score(article, list) * (article.id === "overview" ? 0.5 : 1);
    if (value > bestScore) {
      best = article;
      bestScore = value;
    }
  }
  return best;
}

/**
 * Whether a message asks about Aeyhey itself: it names the app, or asks how one of its
 * parts works ("what is a deck?"), and is not about what the person saved.
 */
export function isAboutApp(text: string): boolean {
  const message = text.trim();
  if (ABOUT_MY_LIBRARY.test(message)) return false;
  if (APP_WORDS.test(message)) return true;
  if (!HOW_IT_WORKS.test(message)) return false;
  const help = findHelp(message);
  if (!help || help.id === "overview") return false;
  // Every word that means something must be one of the app's own: "what is a deck?" is
  // about the app, "what are topics in physics?" is about physics.
  const vocabulary = new Set([...HELP_ARTICLES.flatMap((article) => article.keywords), ...ACTIONS]);
  return searchWords(message).every((word) => {
    const singular = word.endsWith("s") ? word.slice(0, -1) : word;
    return vocabulary.has(word) || vocabulary.has(singular);
  });
}
