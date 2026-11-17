// SPDX-License-Identifier: AGPL-3.0-only
// Decks from a document in any subject: a pasted chapter, a text file, a resume. Through
// the real handler, the real job and the mock AI, so the whole path is covered.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";
import { loadEnv } from "../../src/env";
import { buildRegistry } from "../../src/extensions/registry";
import { createLocalSingleUserAuth, createOwner } from "../../src/extensions/defaults/local-auth";
import { createEnvAndUserKeyProvider } from "../../src/extensions/defaults/env-user-keys";
import { createAllowAllGate } from "../../src/extensions/defaults/allow-all-gate";
import { createLocalUsageSink } from "../../src/extensions/defaults/local-usage-sink";
import { createApi, type Api } from "../../src/api/handlers";
import { createWorker } from "../../src/jobs/worker";
import { documentSlice } from "../../src/questions/generate";
import { buildGenerateQuestionsPrompt } from "../../src/ai/prompts/generate-questions";

const BASE = "http://localhost:3000";
const SECRET = "d".repeat(48);

const CHAPTER = Array.from(
  { length: 40 },
  (_, i) =>
    `Paragraph ${i + 1}. The French Revolution began in 1789 when the Estates-General met at Versailles. ` +
    "Bread prices, debt from foreign wars and new ideas about rights all pushed ordinary people to act.",
).join("\n\n");

let db: TestDb;
let dataDir: string;
let api: Api;
let run: () => Promise<void>;

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-docs-"));
  await createOwner({ handle: db.handle, password: "a-good-password" });
  const env = loadEnv({
    DATA_DIR: dataDir,
    PUBLIC_URL: BASE,
    APP_SECRET: SECRET,
    AI_PROVIDER: "mock",
  });
  const registry = buildRegistry({
    defaults: {
      // AUTH_MODE=none signs every request in as the owner, which is all this test needs.
      auth: createLocalSingleUserAuth({
        handle: db.handle,
        appSecret: SECRET,
        authMode: "none",
        publicUrl: BASE,
      }),
      aiKeys: createEnvAndUserKeyProvider({ handle: db.handle, env, appSecret: SECRET }),
      usageGate: createAllowAllGate(),
      usageSink: createLocalUsageSink(db.handle),
    },
  });
  api = createApi({ handle: db.handle, env, registry, appSecret: SECRET });
  run = () =>
    createWorker({
      handle: db.handle,
      env,
      registry,
      appSecret: SECRET,
      maxPolls: 4,
      pollIntervalMs: 1,
      periodicWork: false,
    }).run();
});

afterEach(async () => {
  await db.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("decks from a document", () => {
  it("studies pasted text in any subject, and names the deck after it", async () => {
    const res = await api.createDocumentSource(
      post("/api/question-sources/document", { text: CHAPTER, title: "French Revolution" }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { sourceId: string; title: string; preview: string };
    expect(created.title).toBe("French Revolution");
    expect(created.preview).toContain("Estates-General");

    const generate = await api.generateFromSource(created.sourceId)(
      post(`/api/question-sources/${created.sourceId}/generate`, {}),
    );
    expect(generate.status).toBe(200);
    await run();

    // The first batch goes straight in: kept, each with a card, and nothing to review.
    const pending = (await (
      await api.getPendingReview(created.sourceId)(new Request(`${BASE}/x`))
    ).json()) as {
      deck: { id: string; name: string; kind: string; counts: { total: number; new: number } };
      questions: { text: string }[];
    };
    expect(pending.deck).toMatchObject({ name: "French Revolution", kind: "document" });
    expect(pending.questions).toHaveLength(0);
    expect(pending.deck.counts.total).toBeGreaterThan(0);
    expect(pending.deck.counts.new).toBe(pending.deck.counts.total);

    const deck = (await (await api.getDeck(pending.deck.id)(new Request(`${BASE}/x`))).json()) as {
      questions: { text: string; reviewStatus: string }[];
      topics: unknown[];
    };
    expect(deck.questions.length).toBe(pending.deck.counts.total);
    expect(deck.questions.every((q) => q.reviewStatus === "kept")).toBe(true);
    expect(deck.questions[0]!.text).toContain("French Revolution");
    expect(deck.topics).toEqual([]);
  });

  it("reads an uploaded text file, and takes the deck name from the file name", async () => {
    const res = await api.createDocumentSource(
      post("/api/question-sources/document", {
        file: {
          name: "physics_chapter-4.txt",
          contentType: "text/plain",
          base64: Buffer.from(CHAPTER.replaceAll("French Revolution", "Newton's laws")).toString(
            "base64",
          ),
        },
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { title: string; kind: string; characters: number };
    expect(created.title).toBe("physics chapter 4");
    expect(created.kind).toBe("text");
    expect(created.characters).toBeGreaterThan(1000);
  });

  it("sends a resume down the resume path, with contact details stripped", async () => {
    const resume = `Jane Doe, jane@example.com, +44 7700 900123.\n${CHAPTER}`;
    const res = await api.createDocumentSource(
      post("/api/question-sources/document", { purpose: "resume", text: resume }),
    );
    const created = (await res.json()) as {
      sourceId: string;
      preview: string;
      redactions: { emails: number };
    };
    expect(created.redactions.emails).toBe(1);
    expect(created.preview).not.toContain("jane@example.com");
  });

  it("refuses a file and text together, and an unreadable file", async () => {
    const both = await api.createDocumentSource(
      post("/api/question-sources/document", {
        text: "x",
        file: { name: "a.txt", base64: Buffer.from("y").toString("base64") },
      }),
    );
    expect(both.status).toBe(400);

    const binary = await api.createDocumentSource(
      post("/api/question-sources/document", {
        file: {
          name: "photo.jpg",
          contentType: "image/jpeg",
          base64: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]).toString("base64"),
        },
      }),
    );
    expect(binary.status).toBe(400);
  });
});

describe("working out what someone wants from a document", () => {
  const upload = (name: string, text: string, extra: Record<string, unknown> = {}) =>
    api.createDocumentSource(
      post("/api/question-sources/document", {
        purpose: "auto",
        file: { name, contentType: "text/plain", base64: Buffer.from(text).toString("base64") },
        ...extra,
      }),
    );

  it("reads a resume as interview prep, without sending contact details to the AI", async () => {
    const resume = [
      "Jane Doe, jane@example.com",
      "Experience: five years building payment APIs in Go and Postgres.",
      "Education: BSc Computer Science.",
      "Skills: Go, Postgres, Kafka.",
    ].join("\n");
    const res = await upload("cv.txt", resume);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      intent: string;
      title: string;
      preview: string;
      documentType: string;
    };
    expect(body).toMatchObject({ intent: "resume", title: "Your resume", documentType: "resume" });
    expect(body.preview).not.toContain("jane@example.com");
  });

  it("studies a chapter as it is", async () => {
    const res = await upload("ch1.txt", CHAPTER);
    const body = (await res.json()) as { intent: string; sourceId: string };
    expect(res.status).toBe(201);
    expect(body.intent).toBe("study");
  });

  it("takes the topics out of a syllabus and makes a topic deck", async () => {
    const syllabus = [
      "Physics 101 outline",
      "1. Newton's laws",
      "2. Work and energy",
      "3. Momentum",
      "4. Circular motion",
    ].join("\n");
    const res = await upload("outline.txt", syllabus, { countPerTopic: 3 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { intent: string; topics: string[]; sourceId: string };
    expect(body.intent).toBe("topics");
    expect(body.topics).toEqual([
      "Newton's laws",
      "Work and energy",
      "Momentum",
      "Circular motion",
    ]);

    await api.generateFromSource(body.sourceId)(post(`/x`, {}));
    await run();
    const pending = (await (
      await api.getPendingReview(body.sourceId)(new Request(`${BASE}/x`))
    ).json()) as { deck: { kind: string } };
    expect(pending.deck.kind).toBe("topics");
  });

  it("does what the person asked, even when the document looks like something else", async () => {
    const res = await upload("ch1.txt", CHAPTER, { instruction: "Pull out the topics please" });
    const body = (await res.json()) as { intent: string };
    expect(body.intent).toBe("topics");
  });

  it("asks rather than guessing, and saves nothing until it knows", async () => {
    const res = await upload("note.txt", "Some notes from Tuesday about a few things.");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intent: string; sourceId: string | null };
    expect(body).toMatchObject({ intent: "unclear", sourceId: null });

    // Once they pick, the same upload goes through.
    const again = await api.createDocumentSource(
      post("/api/question-sources/document", {
        purpose: "study",
        text: "Some notes from Tuesday about a few things.",
      }),
    );
    expect(again.status).toBe(201);
  });
});

describe("questions stay inside the source", () => {
  it("keeps a book deck inside the book and its class, whatever level was picked", () => {
    const prompt = buildGenerateQuestionsPrompt({
      mode: "document",
      documentTitle: "Trigonometric functions",
      documentText: "Radian measure, trigonometric ratios of compound angles.",
      scope: "Class 11 mathematics (CBSE), trigonometry",
      level: "advanced",
      style: "study",
      count: 5,
    });
    expect(prompt).toContain("This material is: Class 11 mathematics (CBSE), trigonometry.");
    expect(prompt).toContain("Stay strictly inside the material below");
    expect(prompt).toContain("nothing from Class 12");
    expect(prompt).toContain("Do not bring in results it has not introduced");
    expect(prompt).toContain("changes how hard they are, not what they cover");
  });

  it("keeps topics from a syllabus inside the syllabus, with the syllabus attached", () => {
    const prompt = buildGenerateQuestionsPrompt({
      mode: "topics",
      topics: ["Trigonometric functions", "Complex numbers"],
      documentText: "Class 11 maths syllabus\n1. Trigonometric functions\n2. Complex numbers",
      scope: "Class 11 mathematics (CBSE)",
      style: "study",
      count: 5,
    });
    expect(prompt).toContain("The topics come from: Class 11 mathematics (CBSE).");
    expect(prompt).toContain("Do not go beyond it");
    expect(prompt).toContain("<document>");
  });

  it("leaves typed topics open, since there is nothing to bound them by", () => {
    const prompt = buildGenerateQuestionsPrompt({
      mode: "topics",
      topics: ["Photosynthesis"],
      style: "study",
      count: 5,
    });
    expect(prompt).not.toContain("Stay strictly");
    expect(prompt).not.toContain("<document>");
  });

  it("writes only interview questions for a resume, even when study was picked", () => {
    const prompt = buildGenerateQuestionsPrompt({
      mode: "resume",
      style: "study",
      count: 5,
    });
    expect(prompt).toContain("Write 5 interview questions");
    expect(prompt).toContain("interview questions only");
    expect(prompt).not.toContain("study checks");
  });

  it("saves the scope and the syllabus with a topic deck taken from a document", async () => {
    const syllabus = [
      "Class 11 Mathematics syllabus",
      "1. Trigonometric functions",
      "2. Complex numbers",
      "3. Permutations and combinations",
    ].join("\n");
    const res = await api.createDocumentSource(
      post("/api/question-sources/document", {
        purpose: "auto",
        file: { name: "maths.txt", base64: Buffer.from(syllabus).toString("base64") },
      }),
    );
    const body = (await res.json()) as { sourceId: string; scope: string; intent: string };
    expect(body.intent).toBe("topics");
    expect(body.scope).toContain("Class 11");

    const { questionSources } = db.handle.schema;
    const { eq } = await import("drizzle-orm");
    const [row] = await db.handle.db
      .select()
      .from(questionSources)
      .where(eq(questionSources.id, body.sourceId));
    expect(row?.scope).toContain("Class 11");
    expect(row?.resumeText).toContain("Permutations and combinations");
  });
});

describe("long documents", () => {
  it("works through a long document slice by slice, not just its opening", () => {
    const text = Array.from({ length: 50 }, (_, i) => `[part ${i}] ${"word ".repeat(200)}`).join(
      "\n",
    );
    const first = documentSlice(text, 0)!;
    const second = documentSlice(text, 1)!;
    expect(first).toContain("[part 0]");
    expect(second).not.toEqual(first);
    const seen = new Set<string>();
    for (let batch = 0; batch < 20; batch += 1) {
      for (const match of documentSlice(text, batch)!.matchAll(/\[part (\d+)\]/g))
        seen.add(match[1]!);
    }
    expect(seen.size).toBe(50);
  });

  it("asks for understanding of the material, not interview questions", () => {
    const prompt = buildGenerateQuestionsPrompt({
      mode: "document",
      documentTitle: "Sapiens",
      documentText: "The cognitive revolution happened about 70,000 years ago.",
      style: "study",
      count: 5,
    });
    expect(prompt).toContain('check understanding of "Sapiens"');
    expect(prompt).toContain("<document>");
    expect(prompt).not.toContain("interviewer");
  });
});
