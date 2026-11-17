"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Settings > Data: the phone apps signed in to this account, each with a sign out button.
//
// Signing one out revokes its token and removes its push registration, so a lost phone
// stops having access and stops getting reminders.

import { useEffect, useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, CardTitle, Notice, Spinner } from "./ui";

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

interface SignedInApp {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** agent: a coding agent's token, which only reports sessions and highlights. */
  scope?: "app" | "agent";
}

export function SignedInApps() {
  const [apps, setApps] = useState<SignedInApp[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ tokens: SignedInApp[] }>("/api/auth/tokens")
      .then((body) => {
        if (!cancelled) setApps(body.tokens);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the signed-in apps.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut(app: SignedInApp): Promise<void> {
    setBusyId(app.id);
    setError(null);
    try {
      await apiClient.delete(`/api/auth/tokens/${app.id}`);
      setApps((current) => current?.filter((candidate) => candidate.id !== app.id) ?? null);
    } catch (thrown) {
      setError(thrown instanceof ApiRequestError ? thrown.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle hint="Phone apps that signed in through this account.">Signed-in apps</CardTitle>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {apps === null && !error ? <Spinner label="Loading" /> : null}
      {apps !== null && apps.length === 0 ? (
        <p className="text-muted-foreground text-sm">No apps are signed in.</p>
      ) : null}
      {apps !== null && apps.length > 0 ? (
        <ul className="divide-border flex flex-col divide-y">
          {apps.map((app) => (
            <li key={app.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">
                  {app.name}
                  {app.scope === "agent" ? (
                    <span className="text-subtle-foreground font-normal"> (coding agent)</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  Signed in {shortDate(app.createdAt)}
                  {app.lastUsedAt ? `, last used ${shortDate(app.lastUsedAt)}` : ""}
                </span>
              </span>
              <Button tone="ghost" disabled={busyId === app.id} onClick={() => void signOut(app)}>
                {busyId === app.id ? "Signing out" : "Sign out"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
