"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// On a read link: write what you learned and put it on your public page (PRD 28).
//
// The summary's last line is offered as a draft, but nothing is shared until the person
// has seen the words and pressed the button.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, CardTitle, Field, Notice, Textarea } from "./ui";

export function TakeawayEditor({
  linkId,
  current,
  draft,
  page,
}: {
  linkId: string;
  current: string | null;
  draft: string;
  /** Where it would show, or why nobody would see it yet. */
  page: { state: "none" } | { state: "off" } | { state: "on"; url: string };
}) {
  const [shared, setShared] = useState(current);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(current ?? draft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const where =
    page.state === "on" ? (
      <>Anyone can see this at {page.url.replace(/^https?:\/\//, "")}.</>
    ) : page.state === "off" ? (
      <>Your page is hidden, so nobody sees this yet.</>
    ) : (
      <>
        You have not set up your page yet, so nobody sees this.{" "}
        <a className="text-primary font-semibold underline" href="/your-page">
          Set it up
        </a>
      </>
    );

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post(`/api/links/${linkId}/share`, { takeaway: text });
      setShared(text.trim());
      setEditing(false);
      setMessage({ ok: true, text: shared ? "Takeaway saved." : "On your page." });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.delete(`/api/links/${linkId}/share`);
      setShared(null);
      setText(draft);
      setEditing(false);
      setMessage({ ok: true, text: "Taken off your page." });
    } catch (caught) {
      setMessage({
        ok: false,
        text: caught instanceof ApiRequestError ? caught.message : "That did not work.",
      });
    } finally {
      setBusy(false);
    }
  }

  const showForm = editing || !shared;

  return (
    <div id="takeaway" className="scroll-mt-6">
      <Card className="border-primary/25 bg-primary-soft/30 flex flex-col gap-3">
        <CardTitle>{shared ? "On your page" : "Add to my page"}</CardTitle>
        {showForm ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) void save();
            }}
          >
            <Field label="What did you learn?" hint={`${text.length} of 500`}>
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={500}
                rows={4}
                placeholder="The one thing worth keeping from this"
              />
            </Field>
            <p className="text-muted-foreground text-xs">{where}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" tone="primary" size="sm" disabled={busy || !text.trim()}>
                {shared ? "Save takeaway" : "Put it on my page"}
              </Button>
              {shared ? (
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setText(shared);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <>
            <p className="border-primary border-l-2 pl-3 text-sm leading-relaxed">{shared}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" tone="ghost" disabled={busy} onClick={() => void remove()}>
                Take it off my page
              </Button>
            </div>
          </>
        )}
        {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}
      </Card>
    </div>
  );
}
