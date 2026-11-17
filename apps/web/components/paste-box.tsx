"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// "Paste a link to save it", as on the phone's Home.
//
// On a phone it floats at the bottom of Home, over a fade, where the thumb is. On a wide
// screen there is no thumb to serve, so it sits in the page beside the session instead.
// Text that is not a link is offered as the start of a question deck, the same as the
// app does.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ClipboardPaste } from "lucide-react";
import { Button } from "@ui-sdk/react/button";
import { apiClient, ApiRequestError } from "../lib/client";
import { pluralize } from "../lib/format";
import { cx } from "./ui";

const LINK = /https?:\/\/\S+|www\.\S+\.\S+/i;

function savedMessage(created: number, duplicates: number): string {
  const parts: string[] = [];
  if (created > 0) parts.push(`Saved ${pluralize(created, "link")}`);
  if (duplicates > 0)
    parts.push(`${duplicates} ${duplicates === 1 ? "was" : "were"} already saved`);
  return parts.length === 0 ? "No links found in that text." : `${parts.join(", ")}.`;
}

export function PasteBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; deck?: string; error?: boolean } | null>(
    null,
  );

  async function paste(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setValue(text);
    } catch {
      setMessage({
        text: "The browser did not allow pasting. Press Ctrl or Cmd and V.",
        error: true,
      });
    }
  }

  async function save(): Promise<void> {
    const text = value.trim();
    if (text === "" || busy) return;
    if (!LINK.test(text)) {
      setMessage({ text: "That is not a link. Make a deck about it?", deck: text });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.post<{ created: number; duplicates: number }>("/api/links", {
        text,
        source: "paste",
      });
      setValue("");
      setMessage({ text: savedMessage(result.created, result.duplicates) });
      router.refresh();
    } catch (thrown) {
      setMessage({
        text:
          thrown instanceof ApiRequestError ? thrown.message : "Something went wrong. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  function makeDeck(topic: string): void {
    window.location.href = `/decks/new?topics=${encodeURIComponent(topic)}`;
  }

  const hasText = value.trim() !== "";

  return (
    <>
      {/* On a phone the list fades out under the floating box. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-36 lg:hidden"
        style={{
          background:
            "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-canvas), var(--color-primary) 5%))",
        }}
      />
      <div
        className={cx(
          "z-30 flex flex-col gap-2",
          "max-lg:fixed max-lg:inset-x-4 max-lg:bottom-[calc(0.75rem+env(safe-area-inset-bottom))]",
        )}
      >
        {message ? (
          <p
            role="status"
            className={cx(
              "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] px-4 py-2.5 text-sm font-medium",
              "max-lg:bg-foreground max-lg:text-canvas lg:px-1 lg:py-0",
              message.error ? "lg:text-danger" : "lg:text-muted-foreground",
            )}
          >
            {message.text}
            {message.deck ? (
              <Button
                disabled={busy}
                onClick={() => makeDeck(message.deck ?? "")}
                className="text-primary font-semibold"
              >
                Make a deck
              </Button>
            ) : null}
          </p>
        ) : null}
        <form
          className="paste-box flex items-end gap-0.5 rounded-[28px] p-1"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="sr-only" htmlFor="paste-box">
            Paste a link to save it
          </label>
          <textarea
            id="paste-box"
            rows={1}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (message) setMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void save();
              }
            }}
            placeholder="Paste a link to save it"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            className="placeholder:text-subtle-foreground field-sizing-content max-h-28 min-h-10 flex-1 resize-none bg-transparent py-2.5 pl-[18px] pr-2 text-[15px] outline-none"
          />
          {hasText ? (
            <Button
              type="submit"
              disabled={busy}
              aria-label="Save"
              className="bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-full"
            >
              {busy ? (
                <span className="border-primary-foreground size-4 animate-spin rounded-full border-2 border-t-transparent" />
              ) : (
                <ArrowUp size={20} aria-hidden="true" />
              )}
            </Button>
          ) : (
            <Button
              onClick={() => void paste()}
              aria-label="Paste"
              className="text-muted-foreground hover:text-foreground grid size-10 shrink-0 place-items-center rounded-full"
            >
              <ClipboardPaste size={20} aria-hidden="true" />
            </Button>
          )}
        </form>
        <a
          href="/add"
          className="text-muted-foreground hover:text-foreground hidden px-1 text-xs font-semibold lg:block"
        >
          Paste many links at once, with a note
        </a>
      </div>
    </>
  );
}
