// SPDX-License-Identifier: AGPL-3.0-only
// The mock AI provider (PRD 8.5 FR-DEMO-2, 13).
//
// Two jobs:
//   1. Demo mode. Someone can try Aeyhey in seconds with no key and no network.
//   2. Tests. Every AI path gets exercised without a provider or a fixture server.
//
// The grader is the interesting one: it scores by keyword overlap with key_points, which
// is crude but honest. A demo user who writes a real answer gets a believable score, and
// one who types nonsense gets a low one.

import type { ContractName } from "./contracts/index";
import type { GradeAnswerOutput, LinkSummary } from "./contracts/index";

export const MOCK_MODEL_ID = "aeyhey-mock" as const;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

const STOP_WORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "they",
  "them",
  "then",
  "than",
  "when",
  "what",
  "which",
  "your",
  "will",
  "would",
  "been",
  "have",
  "into",
  "about",
  "there",
  "their",
  "some",
  "also",
  "more",
  "most",
  "very",
  "just",
  "like",
  "because",
  "should",
  "could",
]);

function meaningful(text: string): Set<string> {
  return new Set(words(text).filter((w) => !STOP_WORDS.has(w)));
}

function mockLinkSummary(prompt: string): LinkSummary {
  const titleMatch = /Page title: (.+)/.exec(prompt);
  const urlMatch = /URL: (\S+)/.exec(prompt);
  const title = titleMatch?.[1]?.trim() ?? "A saved page";
  const host = (() => {
    try {
      return new URL(urlMatch?.[1] ?? "https://example.com").hostname.replace(/^www\./, "");
    } catch {
      return "example.com";
    }
  })();

  const hasContent = prompt.includes("<page>");
  const noteMatch = /<note>\n([\s\S]*?)\n<\/note>/.exec(prompt);

  return {
    summary_lines: [
      `${title} is a piece from ${host}.`,
      "This is demo text, so the summary is canned rather than written by a model.",
      "Add an AI provider in Settings to get real summaries.",
    ],
    why_saved: noteMatch
      ? `You probably saved this because you noted: ${noteMatch[1]!.trim().slice(0, 100)}`
      : "You probably saved this to come back to it when you had more time.",
    tags: [host.split(".")[0] ?? "saved", "demo"],
    content_type: host.includes("youtube") ? "video" : host === "x.com" ? "thread" : "article",
    read_minutes: hasContent ? 5 : 2,
    language: "en",
    confidence: hasContent ? "high" : "low",
  };
}

function mockGrade(prompt: string): GradeAnswerOutput {
  const keyPointBlock = /The key points a correct answer needs:\n([\s\S]*?)\n\n/.exec(prompt);
  const keyPoints = (keyPointBlock?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter((line) => line.length > 0);

  const answerBlock = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(prompt);
  const answer = answerBlock?.[1] ?? "";
  const answerWords = meaningful(answer);

  const covered: string[] = [];
  const missed: string[] = [];

  for (const point of keyPoints) {
    const pointWords = [...meaningful(point)];
    if (pointWords.length === 0) continue;
    const hits = pointWords.filter((w) => answerWords.has(w)).length;
    // Half the meaningful words of a key point present counts as covering it.
    if (hits / pointWords.length >= 0.5) covered.push(point);
    else missed.push(point);
  }

  const total = covered.length + missed.length;
  const ratio = total === 0 ? (answerWords.size > 5 ? 0.7 : 0) : covered.length / total;
  const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  return {
    score,
    verdict: score >= 85 ? "correct" : score >= 40 ? "partial" : "incorrect",
    covered_points: covered,
    missed_points: missed,
    mistakes: [],
    feedback:
      score >= 85
        ? "You covered the key points. This is a solid answer."
        : score >= 40
          ? "You have the right shape, and there are a couple of points left to pick up. Look at what you missed below."
          : "This one needs another look. Read the model answer, then try saying it back in your own words.",
    better_answer_tip:
      "This score comes from the demo grader, which matches keywords. A real model reads the whole answer.",
    suggested_rating: score >= 90 ? "easy" : score >= 65 ? "good" : score >= 40 ? "hard" : "again",
  };
}

type MockStem = { text: (topic: string) => string; points: (topic: string) => string[] };

/**
 * Varied on purpose. An earlier version of this produced "Demo question 1", "Demo
 * question 2" and so on, which differ only by a digit: the dedupe pass correctly
 * collapsed all ten into one, and demo mode looked broken. The stems below are
 * genuinely different questions, so they survive dedupe the way real output would.
 *
 * These are for software: a tech topic, or a resume. Anything else gets STUDY_STEMS.
 */
const ENGINEERING_STEMS: MockStem[] = [
  {
    text: (t) => `How would you explain ${t} to someone who has never used it?`,
    points: (t) => [
      `Define ${t} in plain words`,
      "Give a concrete example",
      "Say when it does not apply",
    ],
  },
  {
    text: (t) => `What is the main trade-off you accept when you reach for ${t}?`,
    points: (t) => [`Name the cost of ${t}`, "Name what you gain", "Say how you would measure it"],
  },
  {
    text: (t) => `Walk through how you would debug a problem with ${t} in production.`,
    points: () => [
      "Start from the symptom",
      "Say what you would measure first",
      "Narrow before changing",
    ],
  },
  {
    text: (t) => `When would you deliberately avoid ${t}, and what would you use instead?`,
    points: (t) => [
      `A case where ${t} is wrong`,
      "A named alternative",
      "Why the alternative fits better",
    ],
  },
  {
    text: (t) => `What breaks first if ${t} has to handle ten times the load?`,
    points: () => [
      "Identify the bottleneck",
      "Say why it is the first to go",
      "Describe one mitigation",
    ],
  },
  {
    text: (t) => `How would you test a change to ${t} before shipping it?`,
    points: () => [
      "What you would assert",
      "How you would get realistic data",
      "What would make you revert",
    ],
  },
  {
    text: (t) =>
      `Tell me about a decision you made involving ${t} that you would make differently now.`,
    points: () => ["The situation", "What you chose and why", "What you learned"],
  },
  {
    text: (t) => `How does ${t} behave when something downstream of it fails?`,
    points: () => ["The failure mode", "What the caller sees", "How you would contain it"],
  },
  {
    text: (t) => `What does a good monitoring setup for ${t} actually watch?`,
    points: () => ["The signal that matters", "A threshold worth alerting on", "What is noise"],
  },
  {
    text: (t) => `If you had one day to improve ${t}, what would you change?`,
    points: () => ["The change", "Why it is the highest value", "How you would know it worked"],
  },
];

/**
 * For any other subject, from physics to history to a novel. An earlier version used the
 * software stems for everything, which asked what breaks when Physics handles ten times
 * the load. These read right for any subject a person might study.
 */
const STUDY_STEMS: MockStem[] = [
  {
    text: (t) => `What is the central idea of ${t}, in your own words?`,
    points: (t) => [`State the idea of ${t} plainly`, "Name the key terms", "Say why it matters"],
  },
  {
    text: (t) => `Give a real example of ${t} and explain what is happening in it.`,
    points: () => [
      "A concrete example",
      "Link each part of the example to the idea",
      "Say what would change the outcome",
    ],
  },
  {
    text: (t) => `What is a common misunderstanding about ${t}, and what is actually true?`,
    points: () => ["The misunderstanding", "Why people believe it", "What is actually true"],
  },
  {
    text: (t) => `Which two or three facts about ${t} does everything else build on?`,
    points: () => ["The core facts", "How they connect", "One thing that follows from them"],
  },
  {
    text: (t) => `How would you work through a typical question on ${t}, step by step?`,
    points: () => ["Say what the question asks", "The steps in order", "How to check the answer"],
  },
  {
    text: (t) => `How does ${t} connect to another idea you have learned?`,
    points: () => ["Name the other idea", "What they share", "Where they differ"],
  },
  {
    text: (t) => `How do we know what we know about ${t}? What is the evidence?`,
    points: () => ["The main evidence", "How it was found or tested", "How strong it is"],
  },
  {
    text: (t) => `Where does ${t} stop applying, or stop being the whole story?`,
    points: () => ["A case at the edge", "Why it falls short there", "What takes over"],
  },
  {
    text: (t) => `How would you explain ${t} to a friend who missed the class?`,
    points: () => [
      "Start from what they already know",
      "One clear example",
      "The one thing to remember",
    ],
  },
  {
    text: (t) => `What question about ${t} would show whether someone really understood it?`,
    points: () => [
      "A question that needs understanding, not recall",
      "What a good answer contains",
      "What a weak answer misses",
    ],
  },
];

/** Topics that are about building software, where the engineering stems make sense. */
const SOFTWARE_TOPIC =
  /\b(apis?|backend|frontend|caching|cache|redis|postgres|mysql|sql|databases?|index(es|ing)?|queues?|kafka|http|rest|graphql|microservices?|services?|servers?|kubernetes|docker|cloud|aws|gcp|azure|devops|deploy\w*|concurrency|threads?|latency|scal\w+|system design|distributed|software|code|coding|programming|typescript|javascript|python|java|golang|rust|react|node|algorithms?|data structures?|auth\w*|security|networking|linux)\b/i;

function stemsFor(topic: string, prompt: string): MockStem[] {
  // A resume prompt is always an interview about the person's own (software) work.
  if (/interview questions for this person/i.test(prompt)) return ENGINEERING_STEMS;
  return SOFTWARE_TOPIC.test(topic) ? ENGINEERING_STEMS : STUDY_STEMS;
}

function mockQuestions(prompt: string): { questions: unknown[] } {
  const countMatch = /Write (\d+) (?:interview )?questions/.exec(prompt);
  const count = Math.min(10, Math.max(1, Number(countMatch?.[1] ?? 5)));
  const topicsMatch = /about these topics: (.+?)\./.exec(prompt);
  const documentMatch = /check understanding of "(.+?)"/.exec(prompt);
  const topics = (topicsMatch?.[1] ?? documentMatch?.[1] ?? "your background")
    .split(",")
    .map((t) => t.trim());

  // Avoid repeating a stem the prompt says the user already has, so a second generation
  // run produces different questions rather than duplicates.
  const alreadyAsked = prompt.toLowerCase();

  const chosen: { stem: MockStem; topic: string; study: boolean }[] = [];
  for (let offset = 0; offset < ENGINEERING_STEMS.length && chosen.length < count; offset += 1) {
    for (const topic of topics) {
      if (chosen.length >= count) break;
      const stems = stemsFor(topic, prompt);
      const stem = stems[offset % stems.length]!;
      const text = stem.text(topic);
      if (alreadyAsked.includes(text.toLowerCase().slice(0, 40))) continue;
      chosen.push({ stem, topic, study: stems === STUDY_STEMS });
    }
  }

  return {
    questions: chosen.map(({ stem, topic, study }, i) => ({
      text: stem.text(topic),
      model_answer: study
        ? `This is a demo answer about ${topic}. A real model writes 80 to 250 words here: the idea in plain words, an example that shows it, and the mistake people most often make with it. Add an AI provider in Settings to generate real questions and answers.`
        : `This is a demo answer about ${topic}. A real model writes 80 to 250 words here, covering the main approach, the trade-off that matters most, and what you would measure to know it worked. Add an AI provider in Settings to generate real questions and answers.`,
      key_points: stem.points(topic),
      tags: [topic.toLowerCase().replace(/\s+/g, "-").slice(0, 40), "demo"],
      category: study
        ? "concept"
        : i % 3 === 0
          ? "system_design"
          : i % 3 === 1
            ? "technical"
            : "concept",
      difficulty: i % 4 === 0 ? "easy" : i % 4 === 3 ? "hard" : "medium",
      resume_anchor: null,
    })),
  };
}

function mockProfile(): unknown {
  return {
    headline: "Demo engineer profile",
    years_experience: 5,
    skills: [
      { name: "TypeScript", category: "language" },
      { name: "Postgres", category: "database" },
      { name: "Docker", category: "tool" },
    ],
    experiences: [
      {
        company: "Demo Company",
        role: "Senior Engineer",
        start: "2022",
        end: null,
        highlights: [
          "This profile is canned demo data, not a real parse.",
          "Add an AI provider to build a profile from your own resume.",
        ],
      },
    ],
    projects: [
      {
        name: "Demo payments service",
        summary: "A stand-in project so the demo questions have something to anchor to.",
        tech: ["TypeScript", "Postgres"],
      },
    ],
    likely_interview_areas: ["API design", "Database indexing", "Idempotency"],
  };
}

/** Text between <tag> and </tag> in a prompt, or an empty string. */
function tagged(prompt: string, tag: string): string {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(prompt);
  return match?.[1] ?? "";
}

/**
 * A rule-of-thumb reading of a document, so demo mode and the tests exercise every path:
 * the request wins, then a resume shape, then a list of topics, then anything long enough
 * to study. Something tiny with no request is "unclear", so the asking path is reachable.
 */
function mockDocumentIntent(prompt: string): unknown {
  const request = tagged(prompt, "request").toLowerCase();
  const doc = tagged(prompt, "document");
  const lower = doc.toLowerCase();
  const firstLine =
    doc
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "Your document";
  const title = firstLine.replace(/[#*]/g, "").slice(0, 60) || "Your document";

  const listed = doc
    .split("\n")
    .map((line) => /^\s*(?:[-*\u2022]|\d+[.)])\s+(.{2,80})$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .slice(0, 10);

  const looksLikeResume = /\bexperience\b/.test(lower) && /\b(education|skills)\b/.test(lower);

  let intent: "study" | "resume" | "topics" | "unclear";
  if (/\btopic|syllabus|outline/.test(request)) intent = "topics";
  else if (/\binterview|resume|cv\b/.test(request)) intent = "resume";
  else if (/\bquiz|understand|study|chapter|book/.test(request)) intent = "study";
  else if (looksLikeResume) intent = "resume";
  else if (listed.length >= 3 && doc.length < 2_000) intent = "topics";
  else if (doc.length < 300) intent = "unclear";
  else intent = "study";

  const topics = intent === "topics" ? (listed.length > 0 ? listed : [title]) : [];
  // A named class or grade is the part of a scope that matters most, so the mock keeps it.
  const grade = /\b(class|grade|year)\s+\d{1,2}\b/i.exec(doc)?.[0] ?? null;
  const scope = intent === "resume" ? "" : grade ? `${title} (${grade})` : title;
  return {
    document_type:
      intent === "resume"
        ? "resume"
        : intent === "topics"
          ? "syllabus"
          : intent === "study"
            ? "book"
            : "other",
    intent,
    title: intent === "resume" ? "Your resume" : title,
    reason:
      intent === "resume"
        ? "This looks like a resume, so the questions will be about your own experience."
        : intent === "topics"
          ? "This looks like a list of things to learn, so I took the topics from it."
          : intent === "study"
            ? "This looks like material to learn from, so the questions will check you understood it."
            : "I could not tell what you would like from this one.",
    topics,
    scope,
  };
}

/**
 * Produces a valid object for any contract. The caller still validates it with Zod,
 * so a mistake here fails the same way a bad model would.
 */
export function mockObjectFor(contract: ContractName, prompt: string): unknown {
  switch (contract) {
    case "link_summary":
      return mockLinkSummary(prompt);
    case "grade_answer":
      return mockGrade(prompt);
    case "generate_questions":
      return mockQuestions(prompt);
    case "resume_profile":
      return mockProfile();
    case "document_intent":
      return mockDocumentIntent(prompt);
    case "agent_digest":
      return mockAgentDigest(prompt);
  }
}

/**
 * One line per goal, from the goals JSON the prompt carries: the first commit when there
 * is one, otherwise the time spent. Crude, but it shows the real shape in demo mode.
 */
function mockAgentDigest(prompt: string): unknown {
  const match = /GOALS_JSON\n([\s\S]*?)\nEND_GOALS_JSON/.exec(prompt);
  let goals: {
    repo: string | null;
    minutes: number;
    commits: string[];
    titles?: string[];
    linesAdded?: number;
    linesRemoved?: number;
  }[] = [];
  try {
    goals = match ? (JSON.parse(match[1]!) as typeof goals) : [];
  } catch {
    goals = [];
  }
  // A standup-shaped note per goal: what changed, then how big it was.
  return {
    highlights: goals.slice(0, 6).map((goal) => {
      const where = goal.repo ?? "a side project";
      const size =
        goal.linesAdded || goal.linesRemoved
          ? ` About ${goal.linesAdded ?? 0} lines added and ${goal.linesRemoved ?? 0} removed.`
          : "";
      if (goal.commits.length > 0) {
        const more =
          goal.commits.length > 1 ? `, along with ${goal.commits.length - 1} related changes` : "";
        return {
          text: `${goal.commits[0]} in ${where}${more}.${size}`,
          kind: "shipped",
          repo: goal.repo,
        };
      }
      const topic = goal.titles?.[0] ?? `work on ${where}`;
      return {
        text: `Spent ${goal.minutes} minutes on ${topic}; still going.${size}`,
        kind: "progress",
        repo: goal.repo,
      };
    }),
  };
}

/** Rough token numbers, so demo mode still populates the stats page. */
export function mockUsage(prompt: string): { inputTokens: number; outputTokens: number } {
  return { inputTokens: Math.ceil(prompt.length / 4), outputTokens: 180 };
}
