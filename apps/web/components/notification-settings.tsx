"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Notification channels (PRD 8.4 FR-SET-3, 14).

import { useEffect, useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { enableWebPush, notShowingHint } from "../lib/web-push";
import { Button, Card, Notice, Page, PageHeader } from "./ui";

export function NotificationSettings({
  telegramConfigured,
  telegramConnected,
  telegramUsername,
}: {
  telegramConfigured: boolean;
  telegramConnected: boolean;
  telegramUsername: string | null;
}) {
  const [pushState, setPushState] = useState<string | null>(null);
  const [telegram, setTelegram] = useState<{
    deepLink: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [connection, setConnection] = useState({
    connected: telegramConnected,
    username: telegramUsername,
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once a push test went out, so the "nothing showed up?" hint appears under it.
  const [pushTested, setPushTested] = useState(false);

  useEffect(() => {
    if (!telegram || connection.connected) return;
    const timer = window.setInterval(() => {
      if (Date.now() > new Date(telegram.expiresAt).getTime()) {
        setTelegram(null);
        setMessage({ ok: false, text: "That connection link expired. Try again." });
        return;
      }
      void apiClient
        .get<{ connected: boolean; username: string | null }>("/api/telegram/connection")
        .then((next) => {
          if (next.connected) {
            setConnection(next);
            setTelegram(null);
            setMessage({ ok: true, text: "Telegram connected." });
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [telegram, connection.connected]);

  async function enablePush(): Promise<void> {
    setBusy(true);
    setPushState(null);
    try {
      await enableWebPush();
      setPushState("This device will get reminders. Use Test to check it.");
    } catch (error) {
      setPushState(error instanceof Error ? error.message : "Could not turn push on here.");
    } finally {
      setBusy(false);
    }
  }

  async function connectTelegram(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiClient.post<{ deepLink: string; code: string; expiresAt: string }>(
        "/api/telegram/link-code",
      );
      setTelegram(result);
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ApiRequestError ? error.message : "Could not get a link.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function disconnectTelegram(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.delete("/api/telegram/connection");
      setConnection({ connected: false, username: null });
      setTelegram(null);
      setMessage({ ok: true, text: "Telegram disconnected." });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ApiRequestError ? error.message : "Could not disconnect Telegram.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function test(channel: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    setPushTested(false);
    try {
      await apiClient.post("/api/notifications/test", { channel });
      setMessage({ ok: true, text: "Sent. Check that it arrived." });
      setPushTested(channel === "push");
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ApiRequestError ? error.message : "That did not send.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Notifications"
        subtitle="Where Aeyhey tells you a session is ready. Pick the ones you actually look at."
      />

      {message ? <Notice tone={message.ok ? "success" : "error"}>{message.text}</Notice> : null}

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Web push</h2>
        <p className="text-muted-foreground text-sm">
          Reminders on this device. Install Aeyhey to your home screen or desktop first. On iPhone
          that is required, not optional.
        </p>
        {pushState ? <Notice tone="info">{pushState}</Notice> : null}
        <div className="flex gap-2">
          <Button tone="primary" disabled={busy} onClick={enablePush}>
            Turn on for this device
          </Button>
          <Button disabled={busy} onClick={() => test("push")}>
            Test
          </Button>
        </div>
        {pushTested ? <p className="text-muted-foreground text-xs">{notShowingHint()}</p> : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Telegram</h2>
        {telegramConfigured ? (
          <>
            <p className="text-muted-foreground text-sm">
              One message per card, each with its own buttons, so you can deal with them in any
              order. Reply to a question with your answer and the bot grades it.
            </p>
            {connection.connected ? (
              <Notice tone="success">
                <span className="font-semibold">Connected</span>
                <span className="mt-1 block text-xs">
                  {connection.username
                    ? `Messages and reminders go to @${connection.username}.`
                    : "Messages and reminders go to your connected Telegram chat."}
                </span>
              </Notice>
            ) : telegram ? (
              <Notice tone="info">
                <a
                  href={telegram.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline"
                >
                  Open AeyheyBot
                </a>
                <span className="mt-1 block text-xs">
                  Approve the connection in Telegram. This page will update automatically.
                </span>
              </Notice>
            ) : null}
            <div className="flex gap-2">
              {connection.connected ? (
                <>
                  <Button disabled={busy} onClick={() => test("telegram")}>
                    Test
                  </Button>
                  <Button tone="danger" disabled={busy} onClick={disconnectTelegram}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button tone="primary" disabled={busy} onClick={connectTelegram}>
                  Connect Telegram
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Message @BotFather on Telegram, send /newbot, then put the token in your environment as{" "}
            <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> and restart.
          </p>
        )}
      </Card>
    </Page>
  );
}
