"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Connecting a coding agent (PRD 29.4): copy one prompt with the address of the public
// setup page (/agents.md). The agent reads it, adds the server and signs in through the
// browser, so no token is copied. A token can still be made for what cannot open a
// browser, such as Claude Code's session hook.
//
// The token is shown once and can only report sessions and highlights. It cannot read
// your links, decks or anything else, because it lives in a config file on a laptop.

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { apiClient, ApiRequestError } from "../lib/client";
import { agentPrompt } from "../lib/agent-setup";
import { CopyCode } from "./copy-code";
import { Button, Card, CardTitle, Notice } from "./ui";

/** A name for the token, so it can be told apart under Data, Signed-in apps. */
function tokenName(): string {
  const platform = navigator.userAgent;
  const machine = /Mac/i.test(platform)
    ? "Mac"
    : /Windows/i.test(platform)
      ? "Windows"
      : /Linux/i.test(platform)
        ? "Linux"
        : "this computer";
  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `Coding agent on ${machine}, ${day}`;
}

export function AgentSettings({ publicUrl }: { publicUrl: string }) {
  const base = publicUrl.replace(/\/+$/, "");
  const prompt = agentPrompt(base);
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function makeToken() {
    setBusy(true);
    setError(null);
    try {
      const issued = await apiClient.post<{ token: string }>("/api/agent/tokens", {
        name: tokenName(),
      });
      setToken(issued.token);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="flex flex-col gap-4">
        <CardTitle hint="Paste it into Claude Code, Codex, Cursor or any agent that speaks MCP. It reads the setup page, adds Aeyhey, and your browser opens to Allow it. No key or token to copy.">
          Connect a coding agent
        </CardTitle>
        <div>
          <Button tone="primary" icon={copied ? Check : Copy} onClick={() => void copyPrompt()}>
            {copied ? "Copied" : "Copy prompt"}
          </Button>
        </div>
        <CopyCode label="The prompt" text={prompt} wrap />
        <p className="text-muted-foreground text-sm">
          Rather set it up yourself? Every step for each agent is on the{" "}
          <a href="/agents" className="text-primary font-semibold hover:underline">
            setup page
          </a>
          . Agents only ever send a one-line note or a link, never code, prompts or file contents.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle hint="For the few things that cannot sign in through a browser, such as Claude Code's session hook. It can only add notes and links, and shows under Data, Signed-in apps to sign out.">
          Make a token
        </CardTitle>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {token ? (
          <>
            <Notice tone="warning">
              Shown once. Put it in your agent&apos;s own settings, never in a project&apos;s files.
            </Notice>
            <CopyCode label="Token" text={token} />
          </>
        ) : (
          <div>
            <Button disabled={busy} onClick={() => void makeToken()}>
              {busy ? "Making a token" : "Make a token"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
