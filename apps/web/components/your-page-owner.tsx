"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// What only the owner sees above their page on Your page: the address with the public
// switch, and the highlights drafted from coding sessions that wait to be kept or dropped.
// Below it the page is drawn as a visitor sees it, so there is no separate Journal.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiRequestError } from "../lib/client";
import { SwitchField } from "./form";
import { Copy, ExternalLink, Globe, Sparkles } from "./icons";
import { Button, Card, Input, LinkButton, Notice, cx } from "./ui";

export function OwnerBar({
  url,
  handle,
  enabled: initialEnabled,
}: {
  url: string;
  handle: string;
  enabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const shortUrl = url.replace(/^https?:\/\//, "");

  async function setPublic(on: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.patch("/api/public-page", { enabled: on });
      setEnabled(on);
      setMessage({ ok: true, text: on ? "Your page is public." : "Your page is hidden." });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ ok: false, text: "Could not copy. Select the address and copy it instead." });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-[30px] font-[640] leading-[1.1] lg:text-4xl">
            Your page
          </h1>
          <p className="text-muted-foreground">
            Below is your page as visitors see it. Edit changes its words, your work and what shows.
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/your-page?edit=1">Edit</LinkButton>
          {enabled ? (
            <LinkButton href={`/u/${handle}`} icon={ExternalLink} external>
              View page
            </LinkButton>
          ) : null}
        </div>
      </div>
      <Card
        className={cx(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6",
          enabled && "border-primary/30 bg-primary-soft/40",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Globe
            size={18}
            aria-hidden="true"
            className={enabled ? "text-primary" : "text-subtle-foreground"}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{shortUrl}</span>
          <Button size="sm" tone="ghost" icon={Copy} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="sm:border-border sm:w-80 sm:border-l sm:pl-6">
          <SwitchField
            label="Public"
            description={
              enabled ? "Anyone with the link can see it." : "Hidden. Only you can see it."
            }
            checked={enabled}
            disabled={busy}
            onCheckedChange={(on) => void setPublic(on)}
          />
        </div>
      </Card>
      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}
    </div>
  );
}

export interface DraftHighlight {
  id: string;
  day: string;
  text: string;
  kind: "shipped" | "progress" | "learned" | "pinned";
  status: "draft" | "kept" | "dropped";
  repo: string | null;
  hiddenFromPage: boolean;
}

const KIND_LABELS: Record<DraftHighlight["kind"], string> = {
  shipped: "Shipped",
  progress: "In progress",
  learned: "Learned",
  pinned: "Pinned",
};

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Highlights drafted from coding sessions. Kept ones go on the page (unless building is
 * set to private); dropped ones are gone. Shown only when there is something to review,
 * or when there was a coding session to draft from.
 */
export function HighlightReview({
  today,
  drafts: initial,
  canDraft,
}: {
  today: string;
  drafts: DraftHighlight[];
  /** There were coding sessions today, so drafting today's highlights can find something. */
  canDraft: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [kept, setKept] = useState(0);

  if (drafts.length === 0 && !canDraft && kept === 0 && !message) return null;

  async function patch(id: string, body: { status: "kept" | "dropped"; text?: string }) {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.patch(`/api/highlights/${id}`, body);
      setDrafts((list) => list.filter((h) => h.id !== id));
      setEditing(null);
      if (body.status === "kept") {
        setKept((count) => count + 1);
        // The kept line now belongs on the page below.
        router.refresh();
      }
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not save.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function draftToday() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.post<{ drafted: number; highlights: DraftHighlight[] }>(
        "/api/agent/digest",
        { day: today },
      );
      const fresh = result.highlights.filter((h) => h.status === "draft");
      setDrafts((list) => [...fresh, ...list.filter((h) => !fresh.some((f) => f.id === h.id))]);
      setMessage({
        ok: true,
        text:
          result.drafted === 0
            ? "Nothing from today stood out yet. Quick questions and sessions without changes are left out."
            : `Drafted ${result.drafted} for today. Keep the ones that matter.`,
      });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-display text-lg font-[620]">To review</h2>
          <p className="text-muted-foreground text-sm">
            {drafts.length > 0
              ? `${drafts.length} ${drafts.length === 1 ? "line" : "lines"} drafted from your coding sessions. Keep what you would tell someone; drop the rest.`
              : "Nothing waiting. Kept lines show on your page under the day they happened."}
          </p>
        </div>
        {canDraft ? (
          <Button size="sm" tone="secondary" icon={Sparkles} disabled={busy} onClick={draftToday}>
            Draft today
          </Button>
        ) : null}
      </div>
      {message ? <Notice tone={message.ok ? "info" : "error"}>{message.text}</Notice> : null}
      {drafts.length > 0 ? (
        <ul className="flex flex-col">
          {drafts.map((h) => (
            <li
              key={h.id}
              className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {editing?.id === h.id ? (
                  <Input
                    aria-label="Highlight"
                    value={editing.text}
                    maxLength={280}
                    autoFocus
                    onChange={(event) => setEditing({ id: h.id, text: event.target.value })}
                  />
                ) : (
                  <p className="leading-snug">{h.text}</p>
                )}
                <p className="text-subtle-foreground text-xs">
                  {dayLabel(h.day, today)}, {KIND_LABELS[h.kind].toLowerCase()}
                  {h.repo ? `, ${h.repo}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {editing?.id === h.id ? (
                  <>
                    <Button
                      size="sm"
                      tone="primary"
                      disabled={busy || editing.text.trim() === ""}
                      onClick={() => patch(h.id, { status: "kept", text: editing.text.trim() })}
                    >
                      Keep
                    </Button>
                    <Button size="sm" tone="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      tone="primary"
                      disabled={busy}
                      onClick={() => patch(h.id, { status: "kept" })}
                    >
                      Keep
                    </Button>
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={busy}
                      onClick={() => setEditing({ id: h.id, text: h.text })}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={busy}
                      onClick={() => patch(h.id, { status: "dropped" })}
                    >
                      Drop
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
