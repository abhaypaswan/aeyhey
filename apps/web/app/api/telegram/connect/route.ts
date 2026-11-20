// SPDX-License-Identifier: AGPL-3.0-only
// Approves a Telegram chat after the user has signed in on the web.

import { notify, security } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

interface TelegramLoginPayload extends Record<string, unknown> {
  chatId: string;
  username?: string;
}

export async function POST(req: Request): Promise<Response> {
  const { handle, registry, appSecret } = await getRuntime();
  const user = await registry.auth.getUser(req);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });

  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const verified = security.verifyToken<TelegramLoginPayload>({
    purpose: "telegram-login",
    token,
    appSecret,
  });
  if (!verified.ok || typeof verified.payload.chatId !== "string") {
    return Response.redirect(new URL("/telegram/connect?error=expired", req.url), 303);
  }

  const connected = await notify.connectTelegramChat(handle, {
    userId: user.id,
    chatId: verified.payload.chatId,
    ...(verified.payload.username ? { username: verified.payload.username } : {}),
  });
  if (!connected.ok) {
    return Response.redirect(new URL("/telegram/connect?error=already-connected", req.url), 303);
  }

  return Response.redirect(new URL("/telegram/connect?connected=1", req.url), 303);
}
