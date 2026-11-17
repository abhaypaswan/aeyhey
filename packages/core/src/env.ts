// SPDX-License-Identifier: AGPL-3.0-only
// Every environment variable from PRD 16.2, parsed once and validated.
//
// Two rules worth remembering:
//   1. Env values override in-app settings, and the settings UI marks those fields locked.
//      lockedSettingKeys() is what the UI reads.
//   2. Nothing here is required. Aeyhey runs with no .env at all.

import { z } from "zod";

const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      const s = v.trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes" || s === "on";
    });

const intish = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === "") return fallback;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    });

const trimmed = z
  .string()
  .optional()
  .transform((v) => {
    const s = v?.trim();
    return s === undefined || s === "" ? undefined : s;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PUBLIC_URL: z.string().default("http://localhost:3000"),
  APP_SECRET: trimmed,
  DATABASE_URL: z.string().default("file:/data/aeyhey.db"),
  DATA_DIR: z.string().default("/data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DEMO_MODE: boolish(false),

  AUTH_MODE: z.enum(["password", "none"]).default("password"),
  /**
   * Comma separated redirects a phone app may be sent back to after /connect. Compared
   * exactly. Unset means "aeyhey://auth".
   */
  API_REDIRECT_URIS: trimmed,
  OWNER_EMAIL: trimmed,
  OWNER_PASSWORD: trimmed,

  AI_PROVIDER: z.enum(["openai", "anthropic", "ollama", "mock"]).optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: trimmed,
  ANTHROPIC_API_KEY: trimmed,
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  AI_MODEL_SUMMARY: trimmed,
  AI_MODEL_GENERATE: trimmed,
  AI_MODEL_GRADE: trimmed,
  AI_MAX_CONCURRENCY: intish(3),
  AI_RPM: intish(30),

  VAPID_PUBLIC_KEY: trimmed,
  VAPID_PRIVATE_KEY: trimmed,
  VAPID_SUBJECT: z.string().default("mailto:admin@localhost"),

  TELEGRAM_BOT_TOKEN: trimmed,
  TELEGRAM_MODE: z.enum(["webhook", "polling", "auto"]).default("auto"),
  TELEGRAM_WEBHOOK_SECRET: trimmed,

  SMTP_URL: trimmed,
  EMAIL_FROM: z.string().default("Aeyhey <noreply@localhost>"),

  FETCH_TIMEOUT_MS: intish(15_000),
  FETCH_ALLOW_PRIVATE: boolish(false),
  MAX_UPLOAD_MB: intish(5),

  EDITION: z.enum(["community", "hosted"]).default("community"),
  FEATURE_FLAGS: trimmed,

  PORT: intish(3000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Your configuration has a problem:\n${lines.join("\n")}`);
  }
  const env = parsed.data;

  if (env.AUTH_MODE === "none") {
    console.warn(
      "[aeyhey] AUTH_MODE=none: anyone who can reach this app is signed in as the owner. " +
        "Only do this on a network you trust.",
    );
  }
  if (env.FETCH_ALLOW_PRIVATE) {
    console.warn(
      "[aeyhey] FETCH_ALLOW_PRIVATE=true: link fetching can reach private network addresses.",
    );
  }
  return env;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper. */
export function setEnvForTests(next: Env | null): void {
  cached = next;
}

export function isPostgres(databaseUrl: string): boolean {
  return databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");
}

export function sqliteFilePath(databaseUrl: string): string {
  return databaseUrl.replace(/^file:/, "");
}

/**
 * Which in-app settings the environment has taken over. The settings screen greys these
 * out and says "set in the environment", so a change that would do nothing is visible
 * rather than confusing (PRD 8.4 FR-SET-2, 16.2).
 */
export function lockedSettingKeys(e: Env = env()): string[] {
  const locked: string[] = [];
  if (e.AI_PROVIDER) locked.push("ai.provider");
  if (e.OPENAI_API_KEY) locked.push("ai.openai.apiKey");
  if (e.ANTHROPIC_API_KEY) locked.push("ai.anthropic.apiKey");
  if (e.OPENAI_BASE_URL !== "https://api.openai.com/v1") locked.push("ai.openai.baseUrl");
  if (e.AI_MODEL_SUMMARY) locked.push("ai.models.summary");
  if (e.AI_MODEL_GENERATE) locked.push("ai.models.generate");
  if (e.AI_MODEL_GRADE) locked.push("ai.models.grade");
  if (e.TELEGRAM_BOT_TOKEN) locked.push("channels.telegram.botToken");
  if (e.SMTP_URL) locked.push("channels.email.smtp");
  if (e.DEMO_MODE) locked.push("ai.provider", "data.delete");
  return [...new Set(locked)];
}
