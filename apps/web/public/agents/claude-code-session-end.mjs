#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Aeyhey's Claude Code hook (PRD 29). Runs when a Claude Code session ends and sends
// Aeyhey one small signal about it, so the day can be turned into a few highlights.
//
// What it sends, and nothing else (the server refuses any other field):
//   the session id, "claude-code", the repo folder name and branch, when the session
//   started and ended, token counts, how many files changed, and the commit messages
//   made during the session. Then counts and names only: models and their tokens,
//   prompts and turns, tool calls by tool name, skills, plugins and MCP servers used,
//   errors, compactions, subagent turns, effort and permission modes, lines added and
//   removed, file extensions changed, busy, thinking, API and tool time, the agent's own
//   cost estimate, and the Claude Code version, entry point and platform.
// It never sends code, prompts, answers, file paths or the transcript. The session's
// short title is sent only if you set AEYHEY_SEND_TITLES=1, since it is written from
// your prompts.
//
// Setup: put AEYHEY_TOKEN (an agent token from Aeyhey Settings, Agents) and, when you
// host Aeyhey yourself, AEYHEY_URL in Claude Code's settings "env", and add this file as
// a SessionEnd hook. Needs Node 18 or later. Never fails the session: any problem is
// silent unless AEYHEY_DEBUG is set. AEYHEY_DRY_RUN=1 prints what would be sent instead.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const URL_BASE = (process.env.AEYHEY_URL || "https://aeyhey.app").replace(/\/+$/, "");
const TOKEN = process.env.AEYHEY_TOKEN || "";
const DEBUG = Boolean(process.env.AEYHEY_DEBUG);
const SEND_TITLES = process.env.AEYHEY_SEND_TITLES === "1";
/** Prints what would be sent and sends nothing, so you can check it yourself. */
const DRY_RUN = process.env.AEYHEY_DRY_RUN === "1";

/** Gaps longer than this between events count as a break, not work. */
const IDLE_MS = 5 * 60 * 1000;

function say(...parts) {
  if (DEBUG) console.error("[aeyhey]", ...parts);
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

/** A name the server accepts: letters, digits and a few marks (no slashes), at most 100. */
function cleanName(name) {
  return String(name)
    .replace(/[^\w.:@+#<>-]/g, "_")
    .slice(0, 100);
}

function bump(map, key, by = 1) {
  if (!key) return;
  const name = cleanName(key);
  map[name] = (map[name] || 0) + by;
}

function nonEmpty(map) {
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * Everything worth counting in the session log. Streamed messages repeat their usage, so
 * usage and tool calls are counted once per message and tool call id.
 */
function readTranscript(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const times = [];
  const messages = new Map(); // message id -> { model, usage, sidechain, effort }
  const toolUses = new Map(); // tool_use id -> name
  const toolCalls = {};
  const skills = {};
  const plugins = {};
  const mcpServers = {};
  const modes = {};
  const effort = {};
  const prompts = new Set();
  let promptCount = 0;
  let toolErrors = 0;
  let apiErrors = 0;
  let compactions = 0;
  let thinkingMs = 0;
  let cost = null;
  let title = null;
  const client = {};

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (!Number.isNaN(at)) times.push(at);
    if (entry.version) client.version = String(entry.version).slice(0, 40);
    if (entry.entrypoint) client.entrypoint = String(entry.entrypoint).slice(0, 40);
    if (entry.clientPlatform) client.platform = String(entry.clientPlatform).slice(0, 40);

    if (entry.type === "custom-title" && entry.customTitle) title = String(entry.customTitle);
    if (entry.type === "cost-state") cost = entry;
    if (entry.type === "system" && entry.subtype === "compact_boundary") compactions += 1;

    const message = entry.message;
    if (entry.type === "assistant" && message) {
      if (entry.isApiErrorMessage) apiErrors += 1;
      if (entry.thinkingDurationMs) thinkingMs += Number(entry.thinkingDurationMs) || 0;
      if (entry.attributionSkill) bump(skills, entry.attributionSkill);
      if (entry.attributionPlugin) bump(plugins, entry.attributionPlugin);
      if (entry.attributionMcpServer) bump(mcpServers, entry.attributionMcpServer);
      const id = message.id || `${messages.size}`;
      messages.set(id, {
        model: message.model,
        usage: message.usage || messages.get(id)?.usage,
        sidechain: Boolean(entry.isSidechain),
        effort: entry.effort,
      });
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block && block.type === "tool_use" && block.name) {
          toolUses.set(block.id || `${toolUses.size}`, block.name);
        }
      }
    }

    if (entry.type === "user" && message && !entry.isMeta && !entry.isSidechain) {
      const content = message.content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block && block.type === "tool_result" && block.is_error) toolErrors += 1;
      }
      const typed =
        typeof content === "string" || blocks.some((block) => block && block.type === "text");
      if (typed) {
        if (entry.promptId) prompts.add(entry.promptId);
        else promptCount += 1;
        if (entry.permissionMode) bump(modes, entry.permissionMode);
      }
    }
  }

  const models = {};
  const serverTools = {};
  const tokens = { input: 0, output: 0, cache: 0 };
  let turns = 0;
  let subagentTurns = 0;
  for (const m of messages.values()) {
    if (!m.model || m.model === "<synthetic>") continue;
    turns += 1;
    if (m.sidechain) subagentTurns += 1;
    if (m.effort) bump(effort, m.effort);
    const u = m.usage || {};
    const input = Number(u.input_tokens) || 0;
    const output = Number(u.output_tokens) || 0;
    const cache =
      (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
    tokens.input += input;
    tokens.output += output;
    tokens.cache += cache;
    const name = cleanName(m.model);
    const current = models[name] || { input: 0, output: 0, cache: 0, messages: 0 };
    models[name] = {
      input: current.input + input,
      output: current.output + output,
      cache: current.cache + cache,
      messages: current.messages + 1,
    };
    for (const [key, value] of Object.entries(u.server_tool_use || {})) {
      if (Number(value) > 0) bump(serverTools, key, Number(value));
    }
  }
  for (const name of toolUses.values()) {
    bump(toolCalls, name);
    // mcp__server__tool: count the server too, when the log did not say.
    const match = /^mcp__(.+?)__/.exec(name);
    if (match && !Object.keys(mcpServers).length) bump(mcpServers, match[1]);
  }

  times.sort((a, b) => a - b);
  let busyMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap <= IDLE_MS) busyMs += gap;
  }

  const seconds = (ms) => (Number(ms) > 0 ? Math.round(Number(ms) / 1000) : undefined);
  return {
    first: times[0] ?? null,
    last: times[times.length - 1] ?? null,
    tokens,
    title,
    details: {
      client: nonEmpty(client),
      models: nonEmpty(models),
      prompts: prompts.size + promptCount,
      turns,
      toolCalls: nonEmpty(toolCalls),
      toolErrors,
      apiErrors,
      compactions,
      subagentTurns,
      skills: nonEmpty(skills),
      plugins: nonEmpty(plugins),
      mcpServers: nonEmpty(mcpServers),
      modes: nonEmpty(modes),
      effort: nonEmpty(effort),
      serverTools: nonEmpty(serverTools),
      busyMinutes: Math.round(busyMs / 60_000),
      thinkingSeconds: seconds(thinkingMs),
      linesAdded: cost?.totalLinesAdded >= 0 ? Number(cost.totalLinesAdded) : undefined,
      linesRemoved: cost?.totalLinesRemoved >= 0 ? Number(cost.totalLinesRemoved) : undefined,
      apiSeconds: seconds(cost?.totalAPIDuration),
      toolSeconds: seconds(cost?.totalToolDuration),
      costUsd: cost?.totalCostUSD >= 0 ? Number(cost.totalCostUSD) : undefined,
    },
  };
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 4000,
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Repo, branch, commits by you since the session started, files touched (as a count
 * and by extension, never paths), and lines changed, for when the log has no totals.
 */
function readGit(cwd, since) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) return { repo: null, branch: null, commits: [], filesChanged: 0, languages: {} };
  const email = git(cwd, ["config", "user.email"]);
  const sinceArg = `--since=${new Date(since).toISOString()}`;
  const author = email ? [`--author=${email}`] : [];
  const commits = git(cwd, ["log", sinceArg, ...author, "--format=%s", "-n", "50"])
    .split("\n")
    .filter(Boolean);

  const files = new Set();
  let added = 0;
  let removed = 0;
  const numstat = [
    git(cwd, ["log", sinceArg, ...author, "--numstat", "--format="]),
    git(cwd, ["diff", "HEAD", "--numstat"]),
  ].join("\n");
  for (const line of numstat.split("\n")) {
    const [plus, minus, path] = line.split("\t");
    if (!path) continue;
    files.add(path);
    added += Number(plus) || 0;
    removed += Number(minus) || 0;
  }
  for (const line of git(cwd, ["status", "--porcelain"]).split("\n")) {
    if (line.trim()) files.add(line.slice(3));
  }
  const languages = {};
  for (const path of files) {
    const ext = extname(path).replace(/^\./, "").toLowerCase();
    bump(languages, ext || basename(path).toLowerCase().slice(0, 20));
  }
  return {
    repo: basename(top),
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || null,
    commits,
    filesChanged: files.size,
    languages,
    added,
    removed,
  };
}

/** Drops empty and undefined fields, so the body stays small. */
function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null),
  );
}

async function main() {
  if (!TOKEN && !DRY_RUN) return say("AEYHEY_TOKEN is not set, so nothing was sent.");
  const input = readStdin();
  if (!input.session_id) return say("No session id from Claude Code.");

  const now = Date.now();
  const log = input.transcript_path ? readTranscript(input.transcript_path) : null;
  const started = log?.first ?? now;
  const ended = Math.max(log?.last ?? now, started);
  const repo = readGit(input.cwd || process.cwd(), started);

  const details = compact({
    ...(log?.details ?? {}),
    languages: nonEmpty(repo.languages),
    linesAdded: log?.details.linesAdded ?? repo.added,
    linesRemoved: log?.details.linesRemoved ?? repo.removed,
    endReason: input.reason ? String(input.reason).slice(0, 40) : undefined,
    title: SEND_TITLES && log?.title ? log.title.slice(0, 200) : undefined,
  });
  if (!details.client) details.client = { platform: process.platform };

  const body = {
    sessionId: String(input.session_id),
    tool: "claude-code",
    repo: repo.repo,
    branch: repo.branch,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    tokens: log ? log.tokens : { input: 0, output: 0, cache: 0 },
    filesChanged: repo.filesChanged,
    commits: repo.commits,
    details,
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${URL_BASE}/api/v1/agent/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    say("sent", res.status, res.status >= 400 ? await res.text() : "");
  } catch (error) {
    say("could not reach Aeyhey:", error?.message ?? error);
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error) => say(error?.message ?? error));
