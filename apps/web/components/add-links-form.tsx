"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The add links screen (PRD 8.1 FR-LINK-1, FR-LINK-2, 12.2).
//
// One big textarea, and a live count of what it found. The count is the important part:
// pasting a newsletter and being told "45 links found, 5 already saved" before anything
// is saved is what makes this feel safe to use on a big paste.
//
// The counting is done here rather than on the server so it updates as you type.

import { useEffect, useMemo, useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import {
  Button,
  Card,
  CardTitle,
  Columns,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  Textarea,
} from "./ui";
import { pluralize } from "../lib/format";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\]}]+/gi;
const BARE_DOMAIN =
  /(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`\]}]*)?/gi;

/**
 * A rough client-side mirror of the server's normalizer, used only for the live count.
 * The server is the authority: it re-normalizes and dedupes against what is already
 * saved, so a small disagreement here only changes a preview number.
 */
function countLinks(text: string): number {
  const seen = new Set<string>();

  const add = (raw: string): void => {
    try {
      const url = new URL(/^[a-z][a-z0-9+-]*:/i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      seen.add(`${host}${url.pathname.replace(/\/$/, "")}`);
    } catch {
      // Not a usable URL, so it does not count.
    }
  };

  for (const match of text.match(URL_PATTERN) ?? []) add(match.replace(/[),.;'"\]]+$/, ""));
  for (const match of text.replace(URL_PATTERN, " ").matchAll(BARE_DOMAIN)) {
    add(`${match[1] ?? ""}${match[2] ?? ""}`);
  }

  return seen.size;
}

export function AddLinksForm({ prefill, shared }: { prefill: string; shared: string | null }) {
  const [text, setText] = useState(prefill);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; duplicates: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const found = useMemo(() => countLinks(text), [text]);

  // Built from the running origin, so a self-hoster on a custom domain gets a bookmarklet
  // that points at their own instance rather than at localhost. Filled in after mount
  // rather than during render: the server has no origin, and reading it during render
  // makes the first client render disagree with the HTML it is hydrating.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const bookmarklet = `javascript:window.open('${origin}/add?url='+encodeURIComponent(location.href),'aeyhey','width=520,height=680')`;
  const single = found === 1;

  async function save(): Promise<void> {
    if (found === 0 || busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await apiClient.post<{ created: number; duplicates: number }>("/api/links", {
        text,
        ...(single && note.trim() ? { note: note.trim() } : {}),
      });
      setResult(response);
      setText("");
      setNote("");
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "Those did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        back={{ href: "/inbox", label: "Inbox" }}
        title="Add links"
        subtitle="Paste one link or a whole pile. Each becomes a card with a short summary, and comes back to you in a session."
      />

      <Columns
        aside={
          <>
            <Card className="flex flex-col gap-3">
              <CardTitle>What happens next</CardTitle>
              <ol className="text-muted-foreground flex list-decimal flex-col gap-2 pl-4 text-sm">
                <li>Aeyhey fetches each page and writes a three line summary.</li>
                <li>It tags the link and guesses why you saved it.</li>
                <li>The link joins your queue and shows up in a coming session.</li>
              </ol>
            </Card>

            <Card className="flex flex-col gap-3">
              <CardTitle>Other ways to save</CardTitle>
              <div className="text-muted-foreground flex flex-col gap-3 text-sm">
                <p>
                  On a phone, install Aeyhey to your home screen and share any link straight into
                  it.
                </p>
                <div className="flex flex-col gap-1.5">
                  <p>
                    On a desktop, make a new bookmark with this as its address. Clicking it saves
                    whatever page you are on:
                  </p>
                  <code className="bg-sunken text-foreground overflow-x-auto whitespace-pre rounded-lg p-2.5 font-mono text-[11px]">
                    {bookmarklet}
                  </code>
                </div>
                <p>Or send a link to the Telegram bot, if you connected one.</p>
              </div>
            </Card>
          </>
        }
      >
        {shared === "saved" ? <Notice tone="success">Saved from the share sheet.</Notice> : null}
        {shared === "duplicate" ? <Notice tone="info">You already had that one.</Notice> : null}

        {result ? (
          <Notice tone="success">
            Saved {pluralize(result.created, "link")}
            {result.duplicates > 0 ? `, ${result.duplicates} already saved` : ""}. Summaries are
            being written now, and they will appear in your{" "}
            <a href="/inbox" className="underline">
              inbox
            </a>
            .
          </Notice>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Card className="flex flex-col gap-4">
          <Field
            label="Paste anything with links in it"
            hint="One per line, or mixed in with other text. Aeyhey finds them."
          >
            <Textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={12}
              placeholder={
                "https://example.com/an-article\nhttps://x.com/someone/status/123\n\nor a whole newsletter pasted in"
              }
              // Shorter on a phone, so the count and Save are on the first screen.
              className="font-mono max-sm:h-44"
            />
          </Field>

          <p className="text-muted-foreground text-sm" role="status">
            {found === 0
              ? "No links yet."
              : `${pluralize(found, "link")} found. Aeyhey will skip any you already have.`}
          </p>

          {single ? (
            <Field
              label="Why are you saving it?"
              hint="Optional, and it is the best hint for the summary."
            >
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="for the Postgres migration"
              />
            </Field>
          ) : null}

          <Button tone="primary" disabled={found === 0 || busy} onClick={save} fullWidth>
            {busy ? "Saving" : found === 0 ? "Save" : `Save ${pluralize(found, "link")}`}
          </Button>
        </Card>
      </Columns>
    </Page>
  );
}
