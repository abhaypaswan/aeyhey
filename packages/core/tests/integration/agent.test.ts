// SPDX-License-Identifier: AGPL-3.0-only
// Daily highlights from coding agents (PRD 29): agent tokens that can do almost nothing,
// sessions that carry only what the list allows, daily totals that do not double count
// parallel sessions, a digest that makes a few highlights out of many sessions, and the
// MCP server. Through the real handlers and the mock AI.

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
import { issueApiToken, withApiTokens } from "../../src/extensions/api-tokens";
import { createApi, type Api } from "../../src/api/handlers";
import { createWorker } from "../../src/jobs/worker";
import { scopeFor } from "../../src/repos/context";
import {
  hideSecrets,
  listAgentDays,
  listHighlights,
  unionMinutes,
  updateHighlight,
} from "../../src/repos/agent";
import { planDigest, queueDigests } from "../../src/agent/digest";

const BASE = "http://localhost:3000";
const SECRET = "a".repeat(48);
const DAY = "2026-11-16";

let db: TestDb;
let dataDir: string;
let api: Api;
let ownerId: string;
let agentToken: string;
let appToken: string;
let run: () => Promise<void>;

function request(method: string, path: string, token: string, body?: unknown): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** A session on DAY, from [start] to [end] (HH:MM, UTC). */
function session(id: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    tool: "claude-code",
    repo: "aeyhey",
    branch: "main",
    startedAt: `${DAY}T${start}:00Z`,
    endedAt: `${DAY}T${end}:00Z`,
    tokens: { input: 1000, output: 200, cache: 5000 },
    filesChanged: 3,
    commits: [],
    ...extra,
  };
}

const report = (body: unknown, token = agentToken) =>
  api.reportAgentSession(request("POST", "/api/agent/sessions", token, body));

beforeEach(async () => {
  db = await createTestDb();
  dataDir = mkdtempSync(join(tmpdir(), "aeyhey-agent-"));
  const owner = await createOwner({ handle: db.handle, password: "a-good-password" });
  ownerId = owner.id;
  const env = loadEnv({
    DATA_DIR: dataDir,
    PUBLIC_URL: BASE,
    APP_SECRET: SECRET,
    AI_PROVIDER: "mock",
  });
  const registry = buildRegistry({
    defaults: {
      auth: createLocalSingleUserAuth({
        handle: db.handle,
        appSecret: SECRET,
        authMode: "password",
        publicUrl: BASE,
      }),
      aiKeys: createEnvAndUserKeyProvider({ handle: db.handle, env, appSecret: SECRET }),
      usageGate: createAllowAllGate(),
      usageSink: createLocalUsageSink(db.handle),
    },
    wrapAuth: (provider) => withApiTokens(provider, { handle: db.handle }),
  });
  api = createApi({ handle: db.handle, env, registry, appSecret: SECRET });
  agentToken = (await issueApiToken(db.handle, { userId: ownerId, name: "Laptop", scope: "agent" }))
    .token;
  appToken = (await issueApiToken(db.handle, { userId: ownerId, name: "Phone" })).token;
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

describe("agent tokens", () => {
  it("can report sessions and pin highlights, and nothing else", async () => {
    expect((await report(session("s1", "09:00", "09:30"))).status).toBe(202);
    const pinned = await api.pinHighlight(
      request("POST", "/api/agent/highlights", agentToken, { text: "Chose SQLite for v1" }),
    );
    expect(pinned.status).toBe(201);

    // Reading anything, or minting another token, is refused.
    for (const res of [
      await api.listLinks(request("GET", "/api/links", agentToken)),
      await api.listHighlights(request("GET", "/api/highlights", agentToken)),
      await api.agentStats(request("GET", "/api/agent/stats", agentToken)),
      await api.createAgentToken(request("POST", "/api/agent/tokens", agentToken, { name: "x" })),
    ]) {
      expect(res.status).toBe(403);
    }
    // An ordinary app token still reads.
    expect((await api.listHighlights(request("GET", "/api/highlights", appToken))).status).toBe(
      200,
    );
  });

  it("are created only by a signed-in app, and say what they are", async () => {
    const res = await api.createAgentToken(
      request("POST", "/api/agent/tokens", appToken, { name: "Work laptop" }),
    );
    expect(res.status).toBe(201);
    const tokens = (await (
      await api.listTokens(request("GET", "/api/auth/tokens", appToken))
    ).json()) as {
      tokens: { name: string; scope: string }[];
    };
    expect(tokens.tokens.find((t) => t.name === "Work laptop")?.scope).toBe("agent");
  });
});

describe("sessions", () => {
  it("refuse any field outside the list, such as a prompt", async () => {
    const res = await report(session("s1", "09:00", "09:30", { prompt: "my secret plan" }));
    expect(res.status).toBe(400);
    const { agentSignals } = db.handle.schema;
    expect(await db.handle.db.select().from(agentSignals)).toHaveLength(0);
  });

  it("count parallel time once, and a resent session once", async () => {
    await report(session("a", "09:00", "10:00"));
    await report(session("b", "09:30", "10:30")); // overlaps a
    await report(session("c", "14:00", "14:30"));
    await report(session("c", "14:00", "15:00")); // c resumed and ended again

    const [day] = await listAgentDays(scopeFor(db.handle, ownerId), DAY);
    expect(day).toMatchObject({
      day: DAY,
      sessions: 3,
      activeMinutes: 150, // 09:00 to 10:30, and 14:00 to 15:00
      agentMinutes: 180,
      inputTokens: 3000,
    });
    expect(day!.tools["claude-code"]).toEqual({ sessions: 3, tokens: 3 * 6200 });
  });

  it("hide secrets in commit messages", async () => {
    await report(
      session("s1", "09:00", "09:30", {
        commits: ["Add key sk-ant-abcdefghijklmnop1234 to config", "Fix login"],
      }),
    );
    const { agentSignals } = db.handle.schema;
    const [row] = await db.handle.db.select().from(agentSignals);
    expect(row!.commits).toEqual(["Add key [hidden] to config", "Fix login"]);
    expect(hideSecrets("https://bob:hunter2@example.com/x")).toBe("[hidden]example.com/x");
  });
});

describe("the digest", () => {
  it("groups by goal and drops quick questions", () => {
    const goals = planDigest([
      {
        tool: "claude-code",
        repo: "aeyhey",
        branch: "main",
        minutes: 30,
        filesChanged: 4,
        commits: ["Add pause"],
      },
      {
        tool: "codex",
        repo: "aeyhey",
        branch: "main",
        minutes: 20,
        filesChanged: 2,
        commits: ["Add pause"],
      },
      {
        tool: "claude-code",
        repo: "site",
        branch: "blog",
        minutes: 50,
        filesChanged: 1,
        commits: [],
      },
      { tool: "claude-code", repo: null, branch: null, minutes: 2, filesChanged: 0, commits: [] },
    ]);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({
      repo: "aeyhey",
      sessions: 2,
      minutes: 50,
      commits: ["Add pause"],
    });
  });

  it("turns 30 sessions on two goals into at most five highlights covering both", async () => {
    for (let i = 0; i < 20; i += 1) {
      await report(
        session(`a${i}`, "09:00", "09:20", { repo: "aeyhey", commits: [`Deck pause step ${i}`] }),
      );
    }
    for (let i = 0; i < 10; i += 1) {
      await report(session(`b${i}`, "11:00", "11:40", { repo: "blog", branch: "draft" }));
    }
    const res = await api.draftHighlights(
      request("POST", "/api/agent/digest", appToken, { day: DAY }),
    );
    const body = (await res.json()) as { highlights: { repo: string | null; status: string }[] };
    expect(body.highlights.length).toBeGreaterThan(0);
    expect(body.highlights.length).toBeLessThanOrEqual(5);
    expect(new Set(body.highlights.map((h) => h.repo))).toEqual(new Set(["aeyhey", "blog"]));
    expect(body.highlights.every((h) => h.status === "draft")).toBe(true);
  });

  it("keeps what the person decided when it runs again, and pinned lines too", async () => {
    await report(session("s1", "09:00", "09:40", { commits: ["Ship profile pictures"] }));
    const scope = scopeFor(db.handle, ownerId);
    await api.draftHighlights(request("POST", "/api/agent/digest", appToken, { day: DAY }));
    const [draft] = await listHighlights(scope, { from: DAY, to: DAY });
    await updateHighlight(scope, draft!.id, { status: "kept", text: "Shipped profile pictures" });

    await api.draftHighlights(request("POST", "/api/agent/digest", appToken, { day: DAY }));
    const after = await listHighlights(scope, { from: DAY, to: DAY });
    expect(after.filter((h) => h.status === "kept").map((h) => h.text)).toEqual([
      "Shipped profile pictures",
    ]);
  });

  it("is queued once a day is over, runs in the worker, and costs nothing for an empty day", async () => {
    await report(session("s1", "09:00", "09:40", { commits: ["Add MCP server"] }));
    // Still the same day: nothing queued.
    expect(await queueDigests({ handle: db.handle, now: new Date(`${DAY}T20:00:00Z`) })).toBe(0);
    // The next day: queued, and the worker drafts it.
    expect(await queueDigests({ handle: db.handle, now: new Date("2026-11-17T08:00:00Z") })).toBe(
      1,
    );
    await run();
    const drafts = await listHighlights(scopeFor(db.handle, ownerId), { from: DAY, to: DAY });
    expect(drafts.map((h) => h.text)).toEqual(["Add MCP server in aeyhey."]);
    // Digested: not queued again.
    expect(await queueDigests({ handle: db.handle, now: new Date("2026-11-17T09:00:00Z") })).toBe(
      0,
    );
  });

  it("union of time is the union", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 16, h));
    expect(
      unionMinutes([
        { start: at(9), end: at(11) },
        { start: at(10), end: at(12) },
      ]),
    ).toBe(180);
    expect(unionMinutes([])).toBe(0);
  });
});

describe("the MCP server", () => {
  const rpc = (body: unknown) => api.mcp(request("POST", "/api/mcp", agentToken, body));

  it("introduces itself, lists two tools, and keeps a highlight", async () => {
    const init = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      })
    ).json()) as {
      result: { serverInfo: { name: string }; capabilities: { tools: object } };
    };
    expect(init.result.serverInfo.name).toBe("aeyhey");

    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name)).toEqual(["highlight", "save_link"]);

    const call = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "highlight", arguments: { text: "Learned that lsof lists clients too" } },
      })
    ).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(call.result.isError).toBe(false);
    const kept = await listHighlights(scopeFor(db.handle, ownerId), { from: "2000-01-01" });
    expect(kept.map((h) => [h.kind, h.status, h.text])).toEqual([
      ["pinned", "kept", "Learned that lsof lists clients too"],
    ]);
  });

  it("answers an unknown method with an error, not a crash", async () => {
    const res = (await (await rpc({ jsonrpc: "2.0", id: 9, method: "resources/list" })).json()) as {
      error: { code: number };
    };
    expect(res.error.code).toBe(-32601);
  });
});

describe("session details", () => {
  const details = {
    client: { version: "2.1.325", entrypoint: "cli", platform: "darwin" },
    models: { "claude-opus-5-5": { input: 100, output: 50, cache: 1000, messages: 4 } },
    prompts: 3,
    turns: 4,
    toolCalls: { Bash: 5, Edit: 2, mcp__aeyhey__highlight: 1 },
    languages: { ts: 3, md: 1 },
    linesAdded: 120,
    linesRemoved: 30,
    costUsd: 0.42,
    title: "Fix login with key sk-ant-abcdefghijklmnop1234",
    endReason: "prompt_input_exit",
  };

  it("are stored, and added up per day without titles or end reasons", async () => {
    await report(session("a", "09:00", "09:30", { details }));
    await report(
      session("b", "10:00", "10:30", {
        details: {
          ...details,
          models: { "claude-sonnet-5-5": { input: 10, output: 5, cache: 0, messages: 1 } },
        },
      }),
    );
    const [day] = await listAgentDays(scopeFor(db.handle, ownerId), DAY);
    expect(day!.details).toMatchObject({
      prompts: 6,
      linesAdded: 240,
      costUsd: 0.84,
      toolCalls: { Bash: 10, Edit: 4, mcp__aeyhey__highlight: 2 },
      languages: { ts: 6, md: 2 },
      models: {
        "claude-opus-5-5": { input: 100, output: 50, cache: 1000, messages: 4 },
        "claude-sonnet-5-5": { input: 10, output: 5, cache: 0, messages: 1 },
      },
    });
    expect(day!.details.title).toBeUndefined();
    expect(day!.details.endReason).toBeUndefined();

    // The session keeps its title, with the secret hidden, for the digest to use.
    const { agentSignals } = db.handle.schema;
    const rows = await db.handle.db.select().from(agentSignals);
    expect(rows[0]!.details.title).toBe("Fix login with key [hidden]");
  });

  it("refuse anything that is not a count or a name", async () => {
    expect(
      (await report(session("a", "09:00", "09:30", { details: { ...details, prompt: "hi" } })))
        .status,
    ).toBe(400);
    expect(
      (
        await report(
          session("b", "09:00", "09:30", {
            details: { toolCalls: { "Read /Users/me/secret plan.md": 1 } },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("let the digest tell work outside a repo apart by title", () => {
    const goals = planDigest([
      {
        tool: "claude-code",
        repo: null,
        branch: null,
        minutes: 40,
        filesChanged: 0,
        commits: [],
        title: "Research pricing",
      },
      {
        tool: "claude-code",
        repo: null,
        branch: null,
        minutes: 30,
        filesChanged: 0,
        commits: [],
        title: "Plan the launch",
      },
      {
        tool: "claude-code",
        repo: "aeyhey",
        branch: "main",
        minutes: 20,
        filesChanged: 2,
        commits: [],
        linesAdded: 50,
        languages: { ts: 2, md: 1 },
      },
    ]);
    expect(goals).toHaveLength(3);
    expect(goals.find((g) => g.repo === "aeyhey")).toMatchObject({
      linesAdded: 50,
      languages: ["ts", "md"],
    });
  });
});

describe("active time", () => {
  it("uses busy minutes, so a session left open overnight is not a night of work", async () => {
    await report(session("open", "01:00", "23:00", { details: { busyMinutes: 95 } }));
    const [day] = await listAgentDays(scopeFor(db.handle, ownerId), DAY);
    expect(day).toMatchObject({ activeMinutes: 95, agentMinutes: 95 });
  });
});
