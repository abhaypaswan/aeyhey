// SPDX-License-Identifier: AGPL-3.0-only
// Email templates (PRD 14.4, 12.2).
//
// Light HTML with a plain text part, built by hand rather than with a framework. An email
// client is not a browser: no flexbox, no custom fonts, and inline styles only.
//
// Link cards carry one-tap actions that work without opening the app. Question cards do
// not, because answering needs a text box, so they link into the session at that card.

import type { CardView } from "../../sessions/views";
import { newQuestionsLine } from "../types";

export interface EmailActionTokens {
  /** cardId to the signed token for each action. */
  read: Record<string, string>;
  later: Record<string, string>;
  drop: Record<string, string>;
}

export interface SessionEmailInput {
  displayName: string;
  items: CardView[];
  publicUrl: string;
  nextSessionLabel: string;
  tokens: EmailActionTokens;
  unsubscribeToken: string;
  pauseToken: string;
  expiredSinceLast: number;
}

/** "5 cards for you, 3 of them new questions on Physics". Also the subject line. */
export function sessionEmailHeading(items: CardView[]): string {
  const heading = `${items.length} card${items.length === 1 ? "" : "s"} for you`;
  const fresh = newQuestionsLine(items);
  return fresh ? `${heading}, ${fresh}` : heading;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLES = {
  body: "margin:0;padding:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;",
  wrap: "max-width:560px;margin:0 auto;padding:24px 16px;",
  card: "background:#ffffff;border:1px solid #e5e5e7;border-radius:10px;padding:16px;margin:0 0 14px;",
  title: "margin:0 0 6px;font-size:16px;line-height:1.35;font-weight:600;",
  meta: "margin:0 0 10px;font-size:12px;color:#6b6b70;",
  line: "margin:0 0 4px;font-size:14px;line-height:1.45;",
  why: "margin:10px 0 12px;font-size:13px;color:#4a4a50;font-style:italic;",
  button:
    "display:inline-block;padding:9px 14px;margin:0 6px 6px 0;border-radius:7px;font-size:13px;font-weight:600;text-decoration:none;",
  primary: "background:#4f46e5;color:#ffffff;",
  secondary: "background:#f1f1f3;color:#1c1c1e;",
  footer: "margin:20px 0 0;font-size:12px;color:#8a8a8f;line-height:1.6;text-align:center;",
};

function linkCardHtml(item: CardView & { kind: "link" }, input: SessionEmailInput): string {
  const base = `${input.publicUrl}/e`;
  const summary = (item.summaryLines ?? [])
    .map((line) => `<p style="${STYLES.line}">${escapeHtml(line)}</p>`)
    .join("");

  return `<div style="${STYLES.card}">
  ${item.lastChance ? '<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#b45309;">Last chance</p>' : ""}
  <p style="${STYLES.title}">${escapeHtml(item.title)}</p>
  <p style="${STYLES.meta}">${escapeHtml(item.siteName ?? "")}${item.readMinutes ? ` &middot; ${item.readMinutes} min read` : ""}</p>
  ${summary}
  ${item.whySaved ? `<p style="${STYLES.why}">${escapeHtml(item.whySaved)}</p>` : ""}
  <a href="${base}/${input.tokens.read[item.cardId] ?? ""}" style="${STYLES.button}${STYLES.primary}">Read now</a>
  <a href="${base}/${input.tokens.later[item.cardId] ?? ""}" style="${STYLES.button}${STYLES.secondary}">Remind me later</a>
  <a href="${base}/${input.tokens.drop[item.cardId] ?? ""}" style="${STYLES.button}${STYLES.secondary}">Drop</a>
</div>`;
}

function questionCardHtml(item: CardView & { kind: "question" }, input: SessionEmailInput): string {
  return `<div style="${STYLES.card}">
  <p style="${STYLES.meta}">${escapeHtml(item.sourceLabel)} &middot; ${item.difficulty}</p>
  <p style="${STYLES.title}">${escapeHtml(item.text)}</p>
  <a href="${input.publicUrl}/session?card=${encodeURIComponent(item.cardId)}" style="${STYLES.button}${STYLES.primary}">Answer in the app</a>
</div>`;
}

export function renderSessionEmailHtml(input: SessionEmailInput): string {
  const cards = input.items
    .map((item) =>
      item.kind === "link" ? linkCardHtml(item, input) : questionCardHtml(item, input),
    )
    .join("");

  const expiredLine =
    input.expiredSinceLast > 0
      ? `<p style="${STYLES.footer}"><a href="${input.publicUrl}/inbox?status=expired" style="color:#8a8a8f;">${input.expiredSinceLast} link${input.expiredSinceLast === 1 ? "" : "s"} expired since last time</a></p>`
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Aeyhey cards</title></head>
<body style="${STYLES.body}">
<div style="${STYLES.wrap}">
  <p style="margin:0 0 4px;font-size:18px;font-weight:700;">${escapeHtml(sessionEmailHeading(input.items))}</p>
  <p style="margin:0 0 18px;font-size:13px;color:#6b6b70;">Next session: ${escapeHtml(input.nextSessionLabel)}</p>
  ${cards}
  <p style="${STYLES.footer}">
    <a href="${input.publicUrl}/session" style="color:#4f46e5;">Open Aeyhey</a><br>
    <a href="${input.publicUrl}/api/email/pause?token=${input.pauseToken}" style="color:#8a8a8f;">Pause for a week</a>
    &nbsp;&middot;&nbsp;
    <a href="${input.publicUrl}/api/email/pause?token=${input.pauseToken}&amp;for=forever" style="color:#8a8a8f;">Pause until I turn them back on</a>
    &nbsp;&middot;&nbsp;
    <a href="${input.publicUrl}/api/email/unsubscribe?token=${input.unsubscribeToken}" style="color:#8a8a8f;">Unsubscribe</a>
  </p>
  ${expiredLine}
</div>
</body></html>`;
}

/** The plain text part. Some people read mail in a terminal, and every client wants one. */
export function renderSessionEmailText(input: SessionEmailInput): string {
  const lines: string[] = [
    sessionEmailHeading(input.items),
    `Next session: ${input.nextSessionLabel}`,
    "",
  ];

  for (const [index, item] of input.items.entries()) {
    lines.push(`${index + 1}. ${item.kind === "link" ? item.title : item.text}`);

    if (item.kind === "link") {
      if (item.siteName) lines.push(`   ${item.siteName}`);
      for (const line of item.summaryLines ?? []) lines.push(`   ${line}`);
      if (item.whySaved) lines.push(`   ${item.whySaved}`);
      lines.push(`   Read now: ${input.publicUrl}/e/${input.tokens.read[item.cardId] ?? ""}`);
      lines.push(`   Later:    ${input.publicUrl}/e/${input.tokens.later[item.cardId] ?? ""}`);
      lines.push(`   Drop:     ${input.publicUrl}/e/${input.tokens.drop[item.cardId] ?? ""}`);
    } else {
      lines.push(`   ${item.sourceLabel}, ${item.difficulty}`);
      lines.push(`   Answer: ${input.publicUrl}/session?card=${item.cardId}`);
    }
    lines.push("");
  }

  if (input.expiredSinceLast > 0) {
    lines.push(
      `${input.expiredSinceLast} link${input.expiredSinceLast === 1 ? "" : "s"} expired since last time: ${input.publicUrl}/inbox?status=expired`,
    );
    lines.push("");
  }

  lines.push(`Pause for a week: ${input.publicUrl}/api/email/pause?token=${input.pauseToken}`);
  lines.push(
    `Pause until you turn them back on: ${input.publicUrl}/api/email/pause?token=${input.pauseToken}&for=forever`,
  );
  lines.push(
    `Unsubscribe: ${input.publicUrl}/api/email/unsubscribe?token=${input.unsubscribeToken}`,
  );

  return lines.join("\n");
}

export function renderVerifyEmail(input: { publicUrl: string; token: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const url = `${input.publicUrl}/api/email/verify?token=${input.token}`;
  return {
    subject: "Confirm your email for Aeyhey",
    html: `<!doctype html><html><body style="${STYLES.body}"><div style="${STYLES.wrap}">
<p style="margin:0 0 12px;font-size:16px;">Click below to confirm this address, and Aeyhey will start sending your cards here.</p>
<a href="${url}" style="${STYLES.button}${STYLES.primary}">Confirm this address</a>
<p style="${STYLES.footer}">If you did not ask for this, ignore it and nothing will be sent.</p>
</div></body></html>`,
    text: `Confirm your email for Aeyhey:\n\n${url}\n\nIf you did not ask for this, ignore it and nothing will be sent.`,
  };
}
