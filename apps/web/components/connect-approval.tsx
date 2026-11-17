"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The Allow and Cancel buttons on /connect.
//
// Allow asks the server for a one-time code and then hands the browser to the app.
// Cancel goes home: the app sees no answer and stays on its own sign-in screen.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, LinkButton, Notice } from "./ui";

export interface ConnectRequest {
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  deviceName: string;
  state?: string;
}

export function ConnectApproval({ request }: { request: ConnectRequest }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await apiClient.post<{ redirectTo: string }>(
        "/api/auth/connect",
        request,
      );
      setDone(true);
      window.location.href = redirectTo;
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Notice tone="info">
        Done. You can go back to the app now. If it did not open, switch to it yourself.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button tone="primary" onClick={allow} disabled={busy} className="max-sm:w-full">
          {busy ? "Connecting" : "Allow"}
        </Button>
        <LinkButton href="/" className="max-sm:w-full">
          Cancel
        </LinkButton>
      </div>
    </div>
  );
}
