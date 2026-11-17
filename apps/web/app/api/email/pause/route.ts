// SPDX-License-Identifier: AGPL-3.0-only
// "Pause for a week" and "Pause until I turn them back on", from the email footer
// (PRD 12.2). The signed token says whose reminders; ?for=forever says for how long.
import { repos, security } from "@aeyhey/core";
import { getRuntime } from "../../../../runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const token = params.get("token");
  if (!token) return Response.json({ error: "Missing token." }, { status: 400 });

  const { handle, appSecret, env } = await getRuntime();

  const verified = security.verifyToken<{ userId: string }>({
    purpose: "email-action",
    token,
    appSecret,
  });
  if (!verified.ok) {
    return new Response("That link is not valid.", { status: 400 });
  }

  const scope = repos.scopeFor(handle, verified.payload.userId);
  if (params.get("for") === "forever") await repos.pauseIndefinitely(scope);
  else await repos.pauseFor(scope, 7);
  return Response.redirect(`${env.PUBLIC_URL}/settings/schedule?paused=1`, 302);
}
