"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Allow and Cancel on /oauth/authorize, where a coding agent asks to connect.
//
// Allow asks the server for a one-time code and hands the browser back to the agent,
// which trades the code for its token. Cancel tells the agent no, so it stops waiting.

import { useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, LinkButton, Notice } from "./ui";

export interface OauthApprovalRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}

export function OauthApproval({
  request,
  cancelHref,
  agentName,
}: {
  request: OauthApprovalRequest;
  cancelHref: string;
  agentName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function allow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { redirectTo } = await apiClient.post<{ redirectTo: string }>(
        "/api/oauth/approve",
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
      <Notice tone="success">
        Connected. {agentName} can now save links and note what you finish. You can close this tab
        and go back to it.
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
        <LinkButton href={cancelHref} className="max-sm:w-full">
          Cancel
        </LinkButton>
      </div>
    </div>
  );
}
