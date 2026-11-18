// SPDX-License-Identifier: AGPL-3.0-only
// One-tap email actions (PRD 11, 14.4).
//
// GET /e/:token. The token is signed, stored hashed, single use and expires after 7 days.
// Read now redirects to the article; later and drop show a small confirmation page, because
// a redirect to nowhere after tapping Drop is confusing.
//
// This route takes no session cookie on purpose: the point is that it works from a mail
// client. The token is the authentication.

import { applyCardAction } from "@aeyhey/core/sessions";
import { notify, repos } from "@aeyhey/core";
import { getRuntime } from "../../../runtime";

export const dynamic = "force-dynamic";

function page(title: string, body: string, linkUrl?: string): Response {
  // A tiny self-contained page: a mail client's browser may have nothing cached.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#f6f6f7;color:#1c1c1e;padding:24px}
  .card{background:#fff;border:1px solid #e5e5e7;border-radius:12px;padding:28px;max-width:420px;text-align:center}
  h1{margin:0 0 8px;font-size:19px}
  p{margin:0 0 18px;color:#4a4a50;line-height:1.5}
  a{display:inline-block;padding:10px 16px;border-radius:8px;background:#4f46e5;color:#fff;
    text-decoration:none;font-weight:600;font-size:14px}
</style></head>
<body><div class="card">
  <h1>${title}</h1>
  <p>${body}</p>
  <a href="${linkUrl ?? "/"}">Open Aeyhey</a>
</div></body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const { handle, appSecret, env } = await getRuntime();

  const consumed = await notify.consumeActionToken({ handle, appSecret }, token);

  if (!consumed.ok) {
    const message =
      consumed.reason === "expired"
        ? "That link has expired. Links in reminder emails work for 7 days."
        : consumed.reason === "used"
          ? "That link has already been used."
          : "That link is not valid.";
    return page("This link no longer works", message, env.PUBLIC_URL);
  }

  const scope = repos.scopeFor(handle, consumed.userId);

  try {
    const result = await applyCardAction(
      { scope, channel: "email" },
      consumed.cardId,
      consumed.action === "read"
        ? { action: "read" }
        : consumed.action === "drop"
          ? { action: "drop" }
          : { action: "snooze", variant: "default" },
    );

    // Read now goes straight to the article, which is the whole point of one tap.
    if (consumed.action === "read" && result.openUrl) {
      return Response.redirect(result.openUrl, 302);
    }

    return consumed.action === "drop"
      ? page("Dropped", "It will not come back. You can restore it from the inbox.", env.PUBLIC_URL)
      : page("Saved for later", result.nextDueLabel, env.PUBLIC_URL);
  } catch {
    return page(
      "Something went wrong",
      "That card could not be updated. Open the app and try there.",
      env.PUBLIC_URL,
    );
  }
}
