// SPDX-License-Identifier: AGPL-3.0-only
// AI providers (PRD 8.4 FR-SET-2).

import { redirect } from "next/navigation";
import { env as loadEnvFn, lockedSettingKeys } from "@aeyhey/core";
import { flags, pageState } from "../../../lib/server";
import { AiSettings } from "../../../components/ai-settings";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  // Nothing to set up where the server runs the AI for everyone and takes no own keys.
  const edition = await flags();
  if (!edition.byoKeys && !edition.ollama) redirect("/settings");

  const environment = loadEnvFn();
  const params = await searchParams;

  return (
    <AiSettings
      locked={lockedSettingKeys(environment)}
      flags={edition}
      firstRun={params["first"] === "1"}
      current={environment.AI_PROVIDER === "mock" ? undefined : environment.AI_PROVIDER}
      defaults={{ ollamaUrl: environment.OLLAMA_BASE_URL, openaiUrl: environment.OPENAI_BASE_URL }}
    />
  );
}
