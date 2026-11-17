// SPDX-License-Identifier: AGPL-3.0-only
// Log redaction (PRD 17, 25). Strips anything that looks like a key before it reaches a log.

const SECRET_ENV_NAMES = [
  "APP_SECRET",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "SMTP_URL",
  "VAPID_PRIVATE_KEY",
  "OWNER_PASSWORD",
  "POSTGRES_PASSWORD",
] as const;

const SECRET_KEY_HINTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "p256dh",
  "auth",
  "key_enc",
  "api_key_enc",
  "resume_text",
];

const PATTERNS: RegExp[] = [
  // Provider keys.
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // Bearer tokens.
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  // Telegram bot tokens look like 123456789:AA...
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,
  // Credentials inside a URL, for example smtp://user:pass@host.
  /(\b[a-z][a-z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/\s]+)@/gi,
];

export const REDACTED = "[redacted]";

export function redactString(input: string): string {
  let out = input;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, scheme?: string, user?: string) =>
      scheme && user ? `${scheme}${user}:${REDACTED}@` : REDACTED,
    );
  }
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join(REDACTED);
  }
  return out;
}

function looksSecret(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEY_HINTS.some((hint) => k.includes(hint));
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[too deep]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = looksSecret(key) ? REDACTED : redactValue(inner, depth + 1);
  }
  return out;
}

/** Shows only the last 4 characters, which is all the settings UI ever displays. */
export function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 4) return "****";
  return `****${key.slice(-4)}`;
}
