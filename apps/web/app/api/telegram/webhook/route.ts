// SPDX-License-Identifier: AGPL-3.0-only
// The Telegram webhook (PRD 11, 14.3).
//
// Telegram authenticates itself with a secret header, which is checked before the body is
// even read. Then every update is checked against the chat that owns the card, because a
// chat id is not a secret.

import { getRuntime } from "../../../../runtime";
import { handleTelegramUpdate } from "../../../../telegram-updates";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { handle, env, appSecret, registry } = await getRuntime();

  if (!env.TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram is not configured.", { status: 404 });
  }

  const { security } = await import("@aeyhey/core");
  const expected = security.telegramWebhookSecret(appSecret, env.TELEGRAM_WEBHOOK_SECRET);
  const provided = req.headers.get("x-telegram-bot-api-secret-token");

  if (!provided || !security.constantTimeEqual(provided, expected)) {
    // Deliberately terse: an attacker learns nothing from this response.
    return new Response("Forbidden", { status: 403 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Telegram retries anything that is not a 200, so we always acknowledge and log our
  // own failures rather than inviting a retry storm.
  try {
    await handleTelegramUpdate({ handle, env, appSecret, registry }, update);
  } catch (error) {
    console.error("[aeyhey] a telegram update failed", (error as Error).message);
  }

  return Response.json({ ok: true });
}
