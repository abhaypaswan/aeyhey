"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Your name and picture, as Aeyhey and your public page show them.
//
// A picked picture is placed in the circle first and shrunk to 512 pixels in the browser
// (adjust-picture.tsx), so what goes to the server is a few dozen kilobytes whatever the
// camera made.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, Field, Input, Notice } from "./ui";
import { AdjustPicture } from "./adjust-picture";

interface Profile {
  displayName: string;
  avatarUrl: string | null;
}

export function ProfileSettings({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.displayName === "You" ? "" : initial.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const router = useRouter();
  /** A picked file waiting to be placed in the circle. */
  const [adjusting, setAdjusting] = useState<File | null>(null);

  async function send(body: { displayName?: string; avatar?: string | null }, done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await apiClient.patch<Profile>("/api/profile", body);
      setProfile(next);
      setSaved(done);
      // The sidebar shows the name and picture too, and is drawn on the server.
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | undefined) {
    if (file) setAdjusting(file);
  }

  const shown = profile.displayName === "You" ? "" : profile.displayName;

  return (
    <Card className="flex flex-col gap-5">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}

      <div className="flex items-center gap-4">
        <Avatar className="bg-primary-soft text-primary size-20 shrink-0 overflow-hidden rounded-full text-2xl font-extrabold uppercase">
          {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="Your picture" /> : null}
          <AvatarFallback>{(shown || "A").slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" disabled={busy} onClick={() => picker.current?.click()}>
            {profile.avatarUrl ? "Change picture" : "Add a picture"}
          </Button>
          {profile.avatarUrl ? (
            <Button
              tone="ghost"
              disabled={busy}
              onClick={() => send({ avatar: null }, "Picture removed.")}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <AdjustPicture
        file={adjusting}
        onCancel={() => setAdjusting(null)}
        onDone={(dataUrl) => {
          setAdjusting(null);
          void send({ avatar: dataUrl }, "Picture changed.");
        }}
      />

      <Field label="Your name" hint="Shown in Aeyhey and on your public page.">
        <Input
          value={name}
          maxLength={80}
          placeholder="First and last name"
          onChange={(event) => {
            setName(event.target.value);
            setSaved(null);
          }}
        />
      </Field>
      <div>
        <Button
          tone="primary"
          disabled={busy || name.trim() === "" || name.trim() === shown}
          onClick={() => send({ displayName: name.trim() }, "Name saved.")}
        >
          Save name
        </Button>
      </div>
    </Card>
  );
}
