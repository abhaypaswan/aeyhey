// SPDX-License-Identifier: AGPL-3.0-only
// Notification channels (PRD 8.4 FR-SET-3).

import { redirect } from "next/navigation";
import { env as loadEnvFn, notify } from "@aeyhey/core";
import { pageState } from "../../../lib/server";
import { NotificationSettings } from "../../../components/notification-settings";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const environment = loadEnvFn();
  const connection = await notify.findTelegramConnection(
    state.context.scope.handle,
    state.context.user.id,
  );

  return (
    <NotificationSettings
      telegramConfigured={Boolean(environment.TELEGRAM_BOT_TOKEN)}
      telegramConnected={Boolean(connection)}
      telegramUsername={connection?.username ?? null}
    />
  );
}
