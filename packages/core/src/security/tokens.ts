// SPDX-License-Identifier: AGPL-3.0-only
// Signed tokens: session cookies, Telegram sign-in and link codes, and the Telegram webhook
// secret (PRD 17). Where a token is stored, only its hash is, so a database dump cannot be
// replayed.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { constantTimeEqual, deriveKey } from "./crypto";

export type TokenPurpose =
  | "session"
  | "telegram-webhook"
  | "telegram-login"
  | "link-code";

function sign(purpose: TokenPurpose, body: string, appSecret: string): string {
  const key = deriveKey(appSecret, `token:${purpose}`);
  return createHmac("sha256", key).update(body).digest("base64url");
}

export interface SignedToken<T> {
  token: string;
  payload: T;
  expiresAt: Date;
}

/** Signs a small JSON payload. Keep it small: these go in URLs and cookies. */
export function signToken<T extends Record<string, unknown>>(input: {
  purpose: TokenPurpose;
  payload: T;
  appSecret: string;
  ttlMs: number;
  now?: Date;
}): SignedToken<T> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  const body = Buffer.from(
    JSON.stringify({ ...input.payload, exp: expiresAt.getTime() }),
    "utf8",
  ).toString("base64url");
  const signature = sign(input.purpose, body, input.appSecret);
  return { token: `${body}.${signature}`, payload: input.payload, expiresAt };
}

export type VerifyResult<T> =
  { ok: true; payload: T } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyToken<T extends Record<string, unknown>>(input: {
  purpose: TokenPurpose;
  token: string;
  appSecret: string;
  now?: Date;
}): VerifyResult<T> {
  const parts = input.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [body, signature] = parts as [string, string];

  const expected = sign(input.purpose, body, input.appSecret);
  if (!constantTimeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const exp = decoded["exp"];
  if (typeof exp !== "number") return { ok: false, reason: "malformed" };
  if ((input.now ?? new Date()).getTime() > exp) return { ok: false, reason: "expired" };

  const { exp: _exp, ...payload } = decoded;
  return { ok: true, payload: payload as T };
}

/** What gets stored instead of a token, so the raw token only exists where it was sent. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const TEN_MINUTES_MS = 10 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** A short, human-typeable code for linking Telegram. Avoids lookalike characters. */
export function newLinkCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Derived from APP_SECRET when TELEGRAM_WEBHOOK_SECRET is not set (PRD 16.2). */
export function telegramWebhookSecret(appSecret: string, override?: string): string {
  if (override) return override;
  return deriveKey(appSecret, "token:telegram-webhook").toString("hex").slice(0, 48);
}
