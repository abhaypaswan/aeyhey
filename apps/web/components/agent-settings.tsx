"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Connecting a coding agent (PRD 29.4): make an agent token, then copy the setup for
// Claude Code, and the MCP server for any agent that speaks it.
//
// The token is shown once and can only report sessions and highlights. It cannot read
// your links, decks or anything else, because it lives in a config file on a laptop.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, CardTitle, Field, Input, Notice } from "./ui";

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <Button
          size="sm"
          tone="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="border-border bg-sunken overflow-x-auto whitespace-pre rounded-lg border p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

export function AgentSettings({ publicUrl }: { publicUrl: string }) {
  const base = publicUrl.replace(/\/+$/, "");
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const issued = await apiClient.post<{ token: string }>("/api/agent/tokens", {
        name: name.trim(),
      });
      setToken(issued.token);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const shown = token ?? "ahy_your_agent_token";
  const settingsJson = JSON.stringify(
    {
      env: { AEYHEY_URL: base, AEYHEY_TOKEN: shown },
      hooks: {
        SessionEnd: [
          { hooks: [{ type: "command", command: "node ~/.claude/aeyhey-session-end.mjs" }] },
        ],
      },
    },
    null,
    2,
  );

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle hint="Each finished session adds to your day: time, token counts, files changed and commit messages. Never code, prompts or answers.">
          Connect a coding agent
        </CardTitle>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {token ? (
          <Notice tone="warning">
            This token is shown once. Copy the setup below now. It can only report sessions and
            highlights, and you can sign it out from Data, Signed-in apps.
          </Notice>
        ) : (
          <>
            <Field label="Name it" hint="The machine or agent it is for, such as Work laptop.">
              <Input
                value={name}
                maxLength={80}
                placeholder="Work laptop"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div>
              <Button tone="primary" disabled={busy || name.trim() === ""} onClick={create}>
                Create agent token
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle hint="Run once on the machine where you use Claude Code.">Claude Code</CardTitle>
        <Snippet
          label="1. Download the hook"
          text={`mkdir -p ~/.claude && curl -fsSL ${base}/agents/claude-code-session-end.mjs -o ~/.claude/aeyhey-session-end.mjs`}
        />
        <Snippet label="2. Add this to ~/.claude/settings.json" text={settingsJson} />
        <Snippet
          label="3. Optional: let Claude pin a highlight when you ask"
          text={`claude mcp add --transport http aeyhey ${base}/api/v1/mcp --header "Authorization: Bearer ${shown}"`}
        />
        <p className="text-muted-foreground text-sm">
          Merge step 2 into your existing settings rather than replacing them. Needs Node 18 or
          later. The hook sends counts and names only: times, tokens and models, tool calls, lines
          changed, file types and commit messages. To see exactly what it sends, run it with{" "}
          <code className="font-mono text-xs">AEYHEY_DRY_RUN=1</code>.
        </p>
        <p className="text-muted-foreground text-sm">
          Optional: add{" "}
          <code className="font-mono text-xs">&quot;AEYHEY_SEND_TITLES&quot;: &quot;1&quot;</code>{" "}
          to the env block to also send each session&apos;s short title. Titles are written from
          your prompts, so they are off unless you turn them on, but they make better highlights for
          work that leaves no commits.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Other agents</CardTitle>
        <p className="text-muted-foreground text-sm">
          Any agent that supports MCP over HTTP can pin highlights and save links. Add a server at
          this address with the header below, then add the line after it to the project&apos;s
          AGENTS.md.
        </p>
        <Snippet label="MCP server" text={`${base}/api/v1/mcp`} />
        <Snippet label="Header" text={`Authorization: Bearer ${shown}`} />
        <Snippet
          label="AGENTS.md"
          text="When you finish a real goal (not every task), call the aeyhey highlight tool with one short line saying what was done."
        />
      </Card>
    </>
  );
}
