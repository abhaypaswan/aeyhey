"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Notification channels (PRD 8.4 FR-SET-3, 14).

import { useEffect, useState } from "react";
import { apiClient, ApiRequestError } from "../lib/client";
import { Button, Card, Field, Input, Notice, Page, PageHeader } from "./ui";

/**
 * The browser wants the VAPID key as bytes, not base64url. The explicit ArrayBuffer is
 * needed because Uint8Array's buffer type is ArrayBufferLike, which includes
 * SharedArrayBuffer, and applicationServerKey will not accept that.
 */
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);

  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function NotificationSettings({
  telegramConfigured,
  telegramConnected,
  telegramUsername,
  emailConfigured,
  verified,
}: {
  telegramConfigured: boolean;
  telegramConnected: boolean;
  telegramUsername: string | null;
  emailConfigured: boolean;
  verified: string | null;
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
  const [emailAddress, setEmailAddress] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushState(
          "This browser does not support web push. On iPhone, add Aeyhey to your home screen first.",
        );
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState(
          "Notifications are blocked for this site. Allow them in your browser settings.",
        );
        return;
      }

      const { publicKey } = await apiClient.get<{ publicKey: string | null }>(
        "/api/push/vapid-public-key",
      );
      if (!publicKey) {
        setPushState("Push is not set up on this instance.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      await apiClient.post("/api/push/subscribe", {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        userAgent: navigator.userAgent.slice(0, 300),
      });

      setPushState("This device will get reminders. Use Test to check it.");
    } catch (error) {
      setPushState(
        error instanceof ApiRequestError ? error.message : "Could not turn push on here.",
      );
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

  async function verifyEmail(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post("/api/email/verify-request", { address: emailAddress.trim() });
      setMessage({ ok: true, text: "Check your inbox and click the link to confirm." });
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof ApiRequestError ? error.message : "Could not send that.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function test(channel: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await apiClient.post("/api/notifications/test", { channel });
      setMessage({ ok: true, text: "Sent. Check that it arrived." });
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

      {verified === "1" ? <Notice tone="success">Your email is confirmed.</Notice> : null}
      {verified === "0" ? (
        <Notice tone="error">That confirmation link did not work. Send a new one.</Notice>
      ) : null}
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

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold">Email</h2>
        {emailConfigured ? (
          <>
            <p className="text-muted-foreground text-sm">
              One mail per session. Link cards have Read now, Later and Drop buttons that work
              without opening the app.
            </p>
            <Field label="Where to send it" hint="You have to confirm the address first.">
              <Input
                type="email"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                tone="primary"
                disabled={busy || !emailAddress.includes("@")}
                onClick={verifyEmail}
              >
                Send confirmation
              </Button>
              <Button disabled={busy} onClick={() => test("email")}>
                Test
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Set <code className="font-mono text-xs">SMTP_URL</code> in your environment and restart
            to turn this on.
          </p>
        )}
      </Card>
    </Page>
  );
}
