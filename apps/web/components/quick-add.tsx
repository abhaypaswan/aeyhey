"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The quick add box on Today (PRD 12.1 screen 2).
//
// Accepts a link or a topic and works out which it is, so the user does not have to pick
// a mode before typing.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, CardTitle, Input, Notice } from "./ui";
import { Link2, Sparkles } from "./icons";

const URL_PATTERN = /\bhttps?:\/\/\S+/i;
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

export function QuickAdd() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const looksLikeLink = URL_PATTERN.test(value) || BARE_DOMAIN.test(value.trim());

  async function submit(): Promise<void> {
    const text = value.trim();
    if (text === "" || busy) return;

    setBusy(true);
    setMessage(null);

    try {
      if (looksLikeLink) {
        const result = await apiClient.post<{ created: number; duplicates: number }>("/api/links", {
          text,
        });
        setMessage({
          tone: "success",
          text:
            result.created > 0
              ? `Saved ${result.created === 1 ? "it" : `${result.created} links`}. The summary will follow shortly.`
              : "You already saved that one.",
        });
      } else {
        const result = await apiClient.post<{ sourceId: string }>("/api/question-sources/topics", {
          topics: [text],
        });
        window.location.href = `/decks/new/review?source=${result.sourceId}`;
        return;
      }
      setValue("");
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof ApiRequestError ? error.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <CardTitle hint="A link is saved and summarised. A topic becomes a deck of questions.">
        Quick add
      </CardTitle>
      <div className="relative">
        <span className="text-subtle-foreground pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          {looksLikeLink ? <Link2 size={15} /> : <Sparkles size={15} />}
        </span>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="Paste a link, or type a topic"
          aria-label="Add a link or a topic"
          className="pl-9"
        />
      </div>
      <Button tone="primary" disabled={busy || value.trim() === ""} onClick={submit} fullWidth>
        {busy ? "Adding" : looksLikeLink ? "Save link" : "Make questions"}
      </Button>
      {message ? (
        <Notice tone={message.tone === "error" ? "error" : "success"}>{message.text}</Notice>
      ) : (
        <a href="/add" className="text-primary text-xs font-semibold hover:underline">
          Paste many links at once
        </a>
      )}
    </Card>
  );
}
