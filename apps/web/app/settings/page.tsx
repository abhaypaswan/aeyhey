// SPDX-License-Identifier: AGPL-3.0-only
// Settings (PRD 12.1 screen 11, 8.4).

import { redirect } from "next/navigation";
import { repos } from "@aeyhey/core";
import { env as loadEnvFn, lockedSettingKeys } from "@aeyhey/core";
import { pageState, flags } from "../../lib/server";
import { timezoneOptions } from "../../lib/timezones";
import { SettingsView } from "../../components/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const { scope, user } = state.context;
  const settings = await repos.loadSettings(scope);
  const environment = loadEnvFn();

  return (
    <SettingsView
      initial={{
        ...settings,
        pausedUntil: settings.pausedUntil ? settings.pausedUntil.toISOString() : null,
      }}
      timezones={timezoneOptions(settings.timezone)}
      initialTab={(await searchParams).tab}
      publicUrl={environment.PUBLIC_URL}
      profile={{
        displayName: user.displayName,
        avatarUrl: await repos.ownAvatarUrl(scope.handle, user.id),
      }}
      locked={lockedSettingKeys(environment)}
      flags={await flags()}
      channels={{
        telegramConfigured: Boolean(environment.TELEGRAM_BOT_TOKEN),
        emailConfigured: Boolean(environment.SMTP_URL),
      }}
    />
  );
}
