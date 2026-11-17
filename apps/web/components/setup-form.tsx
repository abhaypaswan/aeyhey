"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// First run (PRD 12.1 screen 1).
//
// Three short steps, all skippable except the password. The AI step is skippable on
// purpose: links still save and questions can be written by hand without a provider, and
// making someone find an API key before they can see the app loses them.

import { useState } from "react";
import { AuthLayout } from "./auth-layout";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, Field, Input, Notice } from "./ui";
import { PasswordBox } from "./form";

export function SetupForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The browser knows the timezone, so there is nothing to ask.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const mismatch = confirm !== "" && password !== confirm;
  const tooShort = password !== "" && password.length < 8;

  async function submit(): Promise<void> {
    if (password.length < 8 || mismatch || busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiClient.post("/api/auth/setup", {
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        timezone,
      });
      // The setup call signs them in, so there is no second login step.
      window.location.href = "/settings/ai?first=1";
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Aeyhey</h1>
        <p className="text-muted-foreground text-sm">
          One password and you are in. Everything else can wait.
        </p>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <Field
          label="Choose a password"
          hint="At least 8 characters. This is the only account on this instance."
          {...(tooShort ? { error: "Use at least 8 characters." } : {})}
        >
          <PasswordBox
            autoComplete="new-password"
            value={password}
            onValueChange={setPassword}
            autoFocus
          />
        </Field>

        <Field
          label="Again, to be sure"
          {...(mismatch ? { error: "Those two do not match." } : {})}
        >
          <PasswordBox
            autoComplete="new-password"
            value={confirm}
            onValueChange={setConfirm}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </Field>

        <Field label="Email" hint="Optional. Only used to sign in and for reminder emails.">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="What should Aeyhey call you?" hint="Optional.">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>

        <p className="text-muted-foreground text-xs">
          Your timezone looks like <strong>{timezone}</strong>. You can change it in Settings.
        </p>

        <Button
          tone="primary"
          disabled={password.length < 8 || mismatch || busy}
          onClick={submit}
          fullWidth
        >
          {busy ? "Setting up" : "Get started"}
        </Button>
      </Card>
    </AuthLayout>
  );
}
