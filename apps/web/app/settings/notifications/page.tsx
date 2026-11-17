// SPDX-License-Identifier: AGPL-3.0-only
// Notification channels (PRD 8.4 FR-SET-3).

import { redirect } from "next/navigation";
import { env as loadEnvFn } from "@aeyhey/core";
import { pageState } from "../../../lib/server";
import { NotificationSettings } from "../../../components/notification-settings";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const environment = loadEnvFn();
  const params = await searchParams;

  return (
    <NotificationSettings
      telegramConfigured={Boolean(environment.TELEGRAM_BOT_TOKEN)}
      emailConfigured={Boolean(environment.SMTP_URL)}
      verified={params["verified"] ?? null}
    />
  );
}
