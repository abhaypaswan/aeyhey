"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// What only the owner sees above their page on Your page: the address with the public
// switch, Edit and View page. Below it the page is drawn as a visitor sees it. Lines from
// coding sessions go on it by themselves, so there is nothing to review here.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { SwitchField } from "./form";
import { Copy, ExternalLink, Globe } from "./icons";
import { Button, Card, LinkButton, Notice, cx } from "./ui";

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
