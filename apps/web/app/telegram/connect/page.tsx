// SPDX-License-Identifier: AGPL-3.0-only
// The approval screen opened from /login in the Telegram bot.

import { redirect } from "next/navigation";
import { security } from "@aeyhey/core";
import { Card, Notice, Page, PageHeader, Button } from "../../../components/ui";
import { pageState } from "../../../lib/server";
import { getRuntime } from "../../../runtime";

export const dynamic = "force-dynamic";

interface TelegramLoginPayload extends Record<string, unknown> {
  chatId: string;
  username?: string;
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function TelegramConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (one(params["error"]) === "already-connected") {
    return (
      <Page width="narrow">
        <PageHeader title="Connect Telegram" />
        <Notice tone="error">
          This Telegram chat is connected to another Aeyhey account. Disconnect it there first, then
          send /login to AeyheyBot again.
        </Notice>
      </Page>
    );
  }
  if (one(params["connected"]) === "1") {
    return (
      <Page width="narrow">
        <PageHeader title="Telegram connected" />
        <Notice tone="success">You can return to Telegram and start talking to Aeyhey.</Notice>
        <a href="/settings/notifications" className="text-primary font-semibold underline">
          Manage connection
        </a>
      </Page>
    );
  }

  const token = one(params["token"]);
  const { appSecret, registry } = await getRuntime();
  const verified = security.verifyToken<TelegramLoginPayload>({
    purpose: "telegram-login",
    token,
    appSecret,
  });
  if (!verified.ok || typeof verified.payload.chatId !== "string") {
    return (
      <Page width="narrow">
        <PageHeader title="Connect Telegram" />
        <Notice tone="error">
          This connection link has expired. Send /login to AeyheyBot again.
        </Notice>
      </Page>
    );
  }

  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") {
    const signIn = registry.auth.routes?.signIn ?? "/login";
    const back = `/telegram/connect?token=${encodeURIComponent(token)}`;
    redirect(`${signIn}?next=${encodeURIComponent(back)}`);
  }

  const label = verified.payload.username ? `@${verified.payload.username}` : "this Telegram chat";
  return (
    <Page width="narrow">
      <PageHeader
        title="Connect Telegram"
        subtitle="Approve once, then continue the conversation in Telegram."
      />
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold">Connect {label}?</p>
          <p className="text-muted-foreground text-sm">
            AeyheyBot will be able to answer from your library, save what you send, create practice
            decks, and deliver reminders to this chat.
          </p>
        </div>
        <form action="/api/telegram/connect" method="post">
          <input type="hidden" name="token" value={token} />
          <Button type="submit" tone="primary" fullWidth>
            Connect Telegram
          </Button>
        </form>
        <p className="text-muted-foreground text-xs">
          You can disconnect this chat at any time from Settings, Notifications.
        </p>
      </Card>
    </Page>
  );
}
