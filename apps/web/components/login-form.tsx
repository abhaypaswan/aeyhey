"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Sign in (PRD 12.1).
//
// The email box only appears when the owner actually set an email. On a single-user
// self-hosted instance the email is optional, so an empty field that looks required is
// just something to get stuck on: there is no username, only a password.

import { useEffect, useState } from "react";
import { AuthLayout } from "./auth-layout";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, Field, Input, Notice, Spinner } from "./ui";
import { PasswordBox } from "./form";

export function LoginForm({
  ownerHasEmail,
  next = null,
}: {
  ownerHasEmail: boolean;
  /** A same-site path to go to after signing in. The page has already checked it. */
  next?: string | null;
}) {
  // The page passes what it knows, and this re-checks in case the account changed in
  // another tab. Starting from the server's answer means no flicker in the common case.
  const [needsEmail, setNeedsEmail] = useState(ownerHasEmail);
  const [checked, setChecked] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ ownerHasEmail: boolean }>("/api/auth/me")
      .then((me) => {
        if (!cancelled) setNeedsEmail(me.ownerHasEmail);
      })
      .catch(() => {
        // Keep whatever the server rendered with.
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(): Promise<void> {
    if (password === "" || busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiClient.post("/api/auth/login", {
        ...(needsEmail && email.trim() ? { email: email.trim() } : {}),
        password,
      });
      window.location.href = next ?? "/";
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-muted-foreground text-sm">
          {needsEmail ? "Sign in to your instance." : "Just your password. There is no username."}
        </p>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        {!checked ? <Spinner label="Checking" /> : null}

        {needsEmail ? (
          <Field label="Email">
            <Input
              autoFocus
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
        ) : null}

        <Field label="Password">
          <PasswordBox
            autoComplete="current-password"
            value={password}
            onValueChange={setPassword}
            autoFocus={!needsEmail}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </Field>

        <Button tone="primary" disabled={password === "" || busy} onClick={submit} fullWidth>
          {busy ? "Signing in" : "Sign in"}
        </Button>
      </Card>

      <p className="text-muted-foreground text-center text-xs">
        Forgotten it? There is no password reset on a self-hosted instance. Set OWNER_PASSWORD in
        your environment and restart.
      </p>
    </AuthLayout>
  );
}
