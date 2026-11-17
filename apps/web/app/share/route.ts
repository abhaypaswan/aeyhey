// SPDX-License-Identifier: AGPL-3.0-only
// The PWA share target (PRD 8.1 FR-LINK-6).
//
// Android Chrome posts a form here when the user shares a link into the installed app.
// The URL can arrive in `url`, or inside `text` when the sharing app puts it there, which
// most of them do.

import { jobs, repos } from "@aeyhey/core";
import { getRuntime } from "../../runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { handle, registry, env } = await getRuntime();

  const user = await registry.auth.getUser(req);
  if (!user) return Response.redirect(`${env.PUBLIC_URL}/login`, 302);

  const form = await req.formData();
  // Whichever field carries it, all three are searched for URLs.
  const text = [form.get("url"), form.get("text"), form.get("title")]
    .filter((value): value is string => typeof value === "string")
    .join("\n");

  const scope = repos.scopeFor(handle, user.id);
  const result = await repos.saveLinks(scope, { text, source: "share" });

  for (const link of result.created) {
    await jobs.enqueue(handle, {
      type: "extract_link",
      userId: user.id,
      payload: { linkId: link.id },
      dedupeKey: `extract:${link.id}`,
    });
  }

  const status =
    result.created.length > 0 ? "saved" : result.duplicates.length > 0 ? "duplicate" : "none";
  return Response.redirect(`${env.PUBLIC_URL}/add?shared=${status}`, 303);
}

export async function GET(req: Request): Promise<Response> {
  // Some platforms share with a GET. Hand it to the add screen, prefilled.
  const url = new URL(req.url).searchParams.get("url") ?? "";
  const { env } = await getRuntime();
  return Response.redirect(`${env.PUBLIC_URL}/add?url=${encodeURIComponent(url)}`, 302);
}
