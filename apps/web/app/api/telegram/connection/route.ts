// SPDX-License-Identifier: AGPL-3.0-only
// The signed-in user's Telegram connection.

import { notify } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

async function signedInUser(req: Request) {
  const runtime = await getRuntime();
  const user = await runtime.registry.auth.getUser(req);
  return { runtime, user };
}

export async function GET(req: Request): Promise<Response> {
  const { runtime, user } = await signedInUser(req);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const connection = await notify.findTelegramConnection(runtime.handle, user.id);
  return Response.json({
    connected: Boolean(connection),
    username: connection?.username ?? null,
    linkedAt: connection?.linkedAt.toISOString() ?? null,
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const { runtime, user } = await signedInUser(req);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  await notify.disconnectTelegramChat(runtime.handle, user.id);
  return Response.json({ ok: true });
}
