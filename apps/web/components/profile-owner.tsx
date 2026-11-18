"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// What only the owner sees above their profile: the address to share, with a copy
// button, the Public switch and Edit. Below it the page is drawn as a visitor sees it. Lines from
// coding sessions go on it by themselves, so there is nothing to review here.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Check, Copy, Globe } from "./icons";
import { LinkButton, Notice, cx } from "./ui";

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
      setMessage({ ok: true, text: on ? "Your profile is public." : "Your profile is hidden." });
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
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="font-display text-[30px] font-[640] leading-[1.1] lg:text-4xl">Profile</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            {/* The address, as the link people get. Hidden pages are not reachable, so
                it is plain text then. */}
            <span className="border-border bg-card inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border pl-3 pr-1 text-sm">
              <Globe
                size={15}
                aria-hidden="true"
                className={cx("shrink-0", enabled ? "text-primary" : "text-subtle-foreground")}
              />
              {enabled ? (
                <a
                  href={`/u/${handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-medium underline-offset-2 hover:underline"
                >
                  {shortUrl}
                </a>
              ) : (
                <span className="text-muted-foreground truncate font-medium">{shortUrl}</span>
              )}
              <button
                type="button"
                onClick={() => void copy()}
                aria-label={copied ? "Link copied" : "Copy link"}
                title={copied ? "Copied" : "Copy link"}
                className="text-muted-foreground hover:bg-quiet hover:text-foreground grid size-7 shrink-0 cursor-pointer place-items-center rounded-full transition-colors"
              >
                {copied ? (
                  <Check size={15} aria-hidden="true" className="text-primary" />
                ) : (
                  <Copy size={15} aria-hidden="true" />
                )}
              </button>
            </span>
            <span className="text-muted-foreground text-sm">
              {enabled ? "Anyone with the link can see it." : "Hidden. Only you can see it."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="border-border inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-full border pl-4 pr-2 text-sm font-semibold">
            Public
            <Switch
              aria-label="Public"
              checked={enabled}
              disabled={busy}
              onCheckedChange={(on) => void setPublic(on)}
            >
              <SwitchThumb />
            </Switch>
          </label>
          <LinkButton href="/profile?edit=1">Edit</LinkButton>
        </div>
      </div>
      {message && !message.ok ? <Notice tone="error">{message.text}</Notice> : null}
    </header>
  );
}
