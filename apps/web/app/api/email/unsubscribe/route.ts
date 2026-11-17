// SPDX-License-Identifier: AGPL-3.0-only
import { notify } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

async function handle_(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Missing token." }, { status: 400 });

  const { handle, appSecret } = await getRuntime();
  const result = await notify.unsubscribeEmail({ handle, appSecret }, token);

  return new Response(
    result.ok
      ? "You are unsubscribed. No more session emails will be sent."
      : "That link is not valid.",
    { status: result.ok ? 200 : 400, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

export const GET = handle_;
// Mail clients that support one-click unsubscribe send a POST.
export const POST = handle_;
