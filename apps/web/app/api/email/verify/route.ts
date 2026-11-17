// SPDX-License-Identifier: AGPL-3.0-only
import { notify } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Missing token." }, { status: 400 });

  const { handle, appSecret, env } = await getRuntime();
  const result = await notify.confirmEmail({ handle, appSecret }, token);

  // A browser landed here from a mail client, so a redirect reads better than JSON.
  return Response.redirect(
    `${env.PUBLIC_URL}/settings/notifications?verified=${result.ok ? "1" : "0"}`,
    302,
  );
}
