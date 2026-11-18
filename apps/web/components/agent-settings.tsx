"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Connecting a coding agent (PRD 29.4): make an agent token, then copy one prompt that
// carries it and the address of the public setup page (/agents.md). The agent reads the
// page and configures itself, whichever agent it is, so there is nothing to keep in step
// here per agent.
//
// The token is shown once and can only report sessions and highlights. It cannot read
// your links, decks or anything else, because it lives in a config file on a laptop.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { agentPrompt } from "../lib/agent-setup";
import { CopyCode } from "./copy-code";
import { Button, Card, CardTitle, Field, Input, Notice } from "./ui";

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

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle hint="Claude Code, Codex, Cursor, Gemini CLI or any agent that speaks MCP. Make a token, copy the prompt into your agent, and it reads the setup page and connects itself.">
        Connect a coding agent
      </CardTitle>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {token ? (
        <>
          <Notice tone="warning">
            The token in this prompt is shown once. Copy it now. It can only add notes and links,
            and you can sign it out from Data, Signed-in apps.
          </Notice>
          <CopyCode label="Paste this into your agent" text={agentPrompt(base, token)} wrap />
        </>
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
              Make a token and prompt
            </Button>
          </div>
        </>
      )}
      <p className="text-muted-foreground text-sm">
        Rather do it yourself? Every step for each agent is on the{" "}
        <a href="/agents" className="text-primary font-semibold hover:underline">
          setup page
        </a>
        . Agents only ever send a one-line note or a link, never code, prompts or file contents.
      </p>
    </Card>
  );
}
