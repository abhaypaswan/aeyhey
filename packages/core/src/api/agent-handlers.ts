// SPDX-License-Identifier: AGPL-3.0-only
// Endpoints for coding agents and the daily highlights (PRD 29), and the MCP server.
//
// Only three routes take an agent token: reporting a session, pinning a highlight and
// /mcp. Everything else here is for the person, signed in as usual.

import type { DbHandle } from "../db/client";
import type { AiCallDeps } from "../ai/call";
import { enqueue } from "../jobs/queue";
import { issueApiToken } from "../extensions/api-tokens";
import { scopeFor } from "../repos/context";
import { saveLinks } from "../repos/links";
import {
  keptDays,
  listAgentDays,
  listHighlights,
  localDay,
  pinHighlight,
  saveSignal,
  todayFor,
  updateHighlight,
} from "../repos/agent";
import { digestDay } from "../agent/digest";
import { loadJournal } from "../repos/journal";
import { fail, json, route, type RouteContext } from "./respond";
import type { AuthProvider } from "../extensions/auth";
import * as schemas from "./schemas";
import { withSignInHint } from "./oauth-handlers";

/** How far back the stats and the highlight list look by default. */
const DEFAULT_DAYS = 182;
const MAX_DAYS = 400;

function daysAgo(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return localDay(date, "UTC");
}

export function createAgentApi(deps: {
  handle: DbHandle;
  base: { auth: AuthProvider; publicUrl: string };
  ai: AiCallDeps;
}) {
  const { handle, base, ai } = deps;
  const scope = (ctx: RouteContext<unknown>) => scopeFor(handle, ctx.user.id);
  const agentBase = { ...base, allowAgentToken: true };
  const signInHint =
    (handler: (req: Request) => Promise<Response>) =>
    async (req: Request): Promise<Response> =>
      withSignInHint(await handler(req), base.publicUrl);

  async function saveLinkFor(userId: string, url: string, note: string | null) {
    const result = await saveLinks(scopeFor(handle, userId), { text: url, note, source: "agent" });
    for (const link of result.created) {
      await enqueue(handle, {
        type: "extract_link",
        userId,
        payload: { linkId: link.id },
        dedupeKey: `extract:${link.id}`,
      });
    }
    return result;
  }

  return {
    reportAgentSession: route({ ...agentBase, schema: schemas.AgentSignalSchema }, async (ctx) => {
      const body = ctx.body;
      const day = await saveSignal(scope(ctx), {
        sessionId: body.sessionId,
        tool: body.tool,
        repo: body.repo ?? null,
        branch: body.branch ?? null,
        startedAt: new Date(body.startedAt),
        endedAt: new Date(body.endedAt),
        ...(body.tokens ? { tokens: body.tokens } : {}),
        ...(body.filesChanged !== undefined ? { filesChanged: body.filesChanged } : {}),
        ...(body.commits ? { commits: body.commits } : {}),
        ...(body.details ? { details: body.details } : {}),
      });
      return json({ ok: true, day }, { status: 202 });
    }),

    pinHighlight: route({ ...agentBase, schema: schemas.PinHighlightSchema }, async (ctx) =>
      json(
        {
          highlight: await pinHighlight(scope(ctx), {
            text: ctx.body.text,
            repo: ctx.body.repo ?? null,
          }),
        },
        { status: 201 },
      ),
    ),

    listHighlights: route(base, async (ctx) => {
      const s = scope(ctx);
      const today = await todayFor(handle, s.userId);
      const days = Math.min(MAX_DAYS, Math.max(1, Number(ctx.query.get("days")) || 14));
      return json({ highlights: await listHighlights(s, { from: daysAgo(today, days - 1) }) });
    }),

    updateHighlight: (id: string) =>
      route({ ...base, schema: schemas.HighlightPatchSchema }, async (ctx) => {
        const updated = await updateHighlight(scope(ctx), id, {
          ...(ctx.body.text !== undefined ? { text: ctx.body.text } : {}),
          ...(ctx.body.status !== undefined ? { status: ctx.body.status } : {}),
          ...(ctx.body.hiddenFromPage !== undefined
            ? { hiddenFromPage: ctx.body.hiddenFromPage }
            : {}),
        });
        if (!updated) return fail(404, "not_found", "That is not one of your highlights.");
        return json({ highlight: updated });
      }),

    /** "Summarise my day now": drafts the day's highlights at once. */
    draftHighlights: route({ ...base, schema: schemas.DraftHighlightsSchema }, async (ctx) => {
      const s = scope(ctx);
      const day = ctx.body.day ?? (await todayFor(handle, s.userId));
      const drafted = await digestDay(ai, s, day);
      return json({ day, drafted, highlights: await listHighlights(s, { from: day, to: day }) });
    }),

    /** Each day with what was read, reviewed and built, newest first (PRD 29). */
    journal: route(base, async (ctx) => {
      const s = scope(ctx);
      const today = await todayFor(handle, s.userId);
      const days = Math.min(MAX_DAYS, Math.max(1, Number(ctx.query.get("days")) || 30));
      return json({ today, days: await loadJournal(s, daysAgo(today, days - 1)) });
    }),

    agentStats: route(base, async (ctx) => {
      const s = scope(ctx);
      const today = await todayFor(handle, s.userId);
      const days = Math.min(MAX_DAYS, Math.max(1, Number(ctx.query.get("days")) || DEFAULT_DAYS));
      const from = daysAgo(today, days - 1);
      return json({
        days: await listAgentDays(s, from),
        daysBuilding: (await keptDays(s, from)).length,
        today,
      });
    }),

    /** A token for a coding agent's config: reports sessions and highlights, nothing else. */
    createAgentToken: route({ ...base, schema: schemas.AgentTokenSchema }, async (ctx) => {
      const issued = await issueApiToken(handle, {
        userId: ctx.user.id,
        name: ctx.body.name,
        scope: "agent",
      });
      return json(
        { token: issued.token, tokenId: issued.id, expiresAt: issued.expiresAt.toISOString() },
        { status: 201 },
      );
    }),

    // ---------------------------------------------------------------- MCP (FR-AG-3)

    // Both answer a missing token with a 401 that says where to sign in, which is how an
    // agent finds the browser sign-in (see oauth-handlers.ts).
    mcp: signInHint(
      route(agentBase, async (ctx) => {
        let message: unknown;
        try {
          message = await ctx.req.json();
        } catch {
          return json(rpcError(null, -32700, "That was not valid JSON."), { status: 400 });
        }
        const userId = ctx.user.id;
        const handleOne = (m: unknown) => handleRpc(m, userId);
        if (Array.isArray(message)) {
          const replies = (await Promise.all(message.map(handleOne))).filter((r) => r !== null);
          return replies.length === 0 ? new Response(null, { status: 202 }) : json(replies);
        }
        const reply = await handleOne(message);
        return reply === null ? new Response(null, { status: 202 }) : json(reply);
      }),
    ),

    mcpGet: signInHint(
      route(agentBase, async () =>
        fail(405, "method_not_allowed", "This MCP server answers POST requests only."),
      ),
    ),
  };

  async function handleRpc(raw: unknown, userId: string): Promise<object | null> {
    if (typeof raw !== "object" || raw === null) return rpcError(null, -32600, "Not a request.");
    const m = raw as { id?: string | number | null; method?: unknown; params?: unknown };
    const id = m.id ?? null;
    // A notification has no id and gets no reply.
    if (m.id === undefined) return null;
    const params = (m.params ?? {}) as Record<string, unknown>;

    switch (m.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion:
            typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "aeyhey", version: "1.0.0" },
          instructions:
            "Aeyhey helps the person remember what they read and learn, and writes a short summary of each day's work from what you note. Call highlight with one short past-tense line only when the person asks you to log, note or remember something, or when they reach a real goal; never for every task, and never with code or secrets. Call save_link when they ask to save a link to read later.",
        });
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: MCP_TOOLS });
      case "tools/call":
        return callTool(id, params, userId);
      default:
        return rpcError(id, -32601, `Aeyhey does not know ${String(m.method)}.`);
    }
  }

  async function callTool(
    id: string | number | null,
    params: Record<string, unknown>,
    userId: string,
  ): Promise<object> {
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (params.name === "highlight") {
        const parsed = schemas.PinHighlightSchema.safeParse({
          text: args.text,
          ...(typeof args.repo === "string" ? { repo: args.repo } : {}),
        });
        if (!parsed.success) return toolText(id, "Give the highlight as one short line.", true);
        const saved = await pinHighlight(scopeFor(handle, userId), {
          text: parsed.data.text,
          repo: parsed.data.repo ?? null,
        });
        return toolText(id, `Kept for ${saved.day}: ${saved.text}`);
      }
      if (params.name === "save_link") {
        if (typeof args.url !== "string" || args.url.length > 2_000) {
          return toolText(id, "Give the link as a url.", true);
        }
        const note = typeof args.note === "string" ? args.note.slice(0, 500) : null;
        const result = await saveLinkFor(userId, args.url, note);
        if (result.created.length > 0)
          return toolText(id, "Saved. Aeyhey will bring it back to read.");
        if (result.duplicates.length > 0) return toolText(id, "That link was already saved.");
        return toolText(id, "That does not look like a link Aeyhey can save.", true);
      }
      return rpcError(id, -32602, `There is no tool called ${String(params.name)}.`);
    } catch {
      return toolText(id, "Aeyhey could not save that. Try again in a moment.", true);
    }
  }
}

const MCP_TOOLS = [
  {
    name: "highlight",
    description:
      "Note one line about today's work in the person's Aeyhey. Use it only when they ask to log or remember something, or when a real goal is reached. One short line, past tense, no code or secrets.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One line, at most 280 characters." },
        repo: { type: "string", description: "The project it belongs to, if any." },
      },
      required: ["text"],
    },
  },
  {
    name: "save_link",
    description: "Save a link to the person's Aeyhey inbox, to read later.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        note: { type: "string", description: "Why it is worth reading, in a few words." },
      },
      required: ["url"],
    },
  },
] as const;

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(id: string | number | null, text: string, isError = false) {
  return rpcResult(id, { content: [{ type: "text", text }], isError });
}
