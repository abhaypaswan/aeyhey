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
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makePrompt = async (): Promise<string> => {
    const issued = await apiClient.post<{ token: string }>("/api/agent/tokens", {
      name: tokenName(),
    });
    const text = agentPrompt(base, issued.token);
    setPrompt(text);
    return text;
  };

  async function copyPrompt() {
    setBusy(true);
    setError(null);
    const pending = makePrompt();
    try {
      // Handed to the clipboard while the click still counts, with the text to follow:
      // Safari refuses a write that only starts once the token has come back.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": pending.then((text) => new Blob([text], { type: "text/plain" })),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(await pending);
      }
      setCopied(true);
    } catch (thrown) {
      try {
        // The token was made but the clipboard said no: the prompt is shown to copy by hand.
        await pending;
        setCopied(false);
      } catch {
        setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle hint="Paste it into Claude Code, Codex, Cursor or any agent that speaks MCP. It reads the setup page and connects itself.">
        Connect a coding agent
      </CardTitle>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {prompt ? (
        <>
          <Notice tone={copied ? "success" : "warning"}>
            {copied
              ? "Copied. Paste it into your agent. The token in it is shown only here, once."
              : "Copy this prompt now. The token in it is shown only here, once."}
          </Notice>
          <CopyCode label="The prompt" text={prompt} wrap />
        </>
      ) : (
        <div>
          <Button tone="primary" icon={copied ? Check : Copy} disabled={busy} onClick={copyPrompt}>
            {busy ? "Making a token" : "Copy prompt"}
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        The token in the prompt can only add notes and links, and you can sign it out from Data,
        Signed-in apps. Rather set it up yourself? Every step is on the{" "}
        <a href="/agents" className="text-primary font-semibold hover:underline">
          setup page
        </a>
        .
      </p>
    </Card>
  );
}
