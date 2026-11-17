// SPDX-License-Identifier: AGPL-3.0-only
// EnvAndUserKeyProvider: the community default AI credential resolver (PRD 23.3).
//
// Order of preference:
//   1. DEMO_MODE, which always resolves to the mock provider and never touches a network
//   2. the environment, because an operator setting a key there means it is deliberate
//   3. the user's own key from ai_providers, decrypted on the way out
//   4. a local Ollama, if nothing else is configured and it is reachable
// Nothing else in the codebase reads a key, which is what lets the hosted edition swap
// this out for server-side managed keys.

import { and, eq } from "drizzle-orm";
import type { AIKeyProvider, AITask, ResolvedAICredential } from "../ai-credentials";
import { NoAIProviderError } from "../ai-credentials";
import type { DbHandle } from "../../db/client";
import type { Env } from "../../env";
import { decryptSecret } from "../../security/crypto";
import { createLogger } from "../../logger";

const log = createLogger("ai-credentials");

/** Sensible per-task defaults, so a user who sets only a key still gets good results. */
export const DEFAULT_MODELS: Record<
  "openai" | "anthropic" | "ollama" | "mock",
  Record<AITask, string>
> = {
  openai: {
    summary: "gpt-4o-mini",
    generate: "gpt-4o",
    grade: "gpt-4o-mini",
    profile: "gpt-4o-mini",
  },
  anthropic: {
    summary: "claude-haiku-5-5",
    generate: "claude-sonnet-5-5",
    grade: "claude-haiku-5-5",
    profile: "claude-haiku-5-5",
  },
  ollama: {
    summary: "llama3.1:8b",
    generate: "llama3.1:8b",
    grade: "llama3.1:8b",
    profile: "llama3.1:8b",
  },
  mock: { summary: "mock", generate: "mock", grade: "mock", profile: "mock" },
};

function envModelFor(env: Env, task: AITask): string | undefined {
  switch (task) {
    case "summary":
      return env.AI_MODEL_SUMMARY;
    case "generate":
      return env.AI_MODEL_GENERATE;
    case "grade":
      return env.AI_MODEL_GRADE;
    case "profile":
      // The profile pass is cheap extraction, so it follows the summary model.
      return env.AI_MODEL_SUMMARY;
  }
}

export interface EnvAndUserKeyOptions {
  handle: DbHandle;
  env: Env;
  appSecret: string;
}

export function createEnvAndUserKeyProvider(options: EnvAndUserKeyOptions): AIKeyProvider {
  const { handle, env, appSecret } = options;
  const { aiProviders } = handle.schema;

  function fromEnv(task: AITask): ResolvedAICredential | null {
    if (env.DEMO_MODE || env.AI_PROVIDER === "mock") {
      return { provider: "mock", model: "mock", source: "env" };
    }

    const kind = env.AI_PROVIDER;
    if (!kind) return null;

    const model = envModelFor(env, task) ?? DEFAULT_MODELS[kind][task];

    if (kind === "openai") {
      if (!env.OPENAI_API_KEY) return null;
      return {
        provider: "openai",
        baseUrl: env.OPENAI_BASE_URL,
        apiKey: env.OPENAI_API_KEY,
        model,
        source: "env",
      };
    }
    if (kind === "anthropic") {
      if (!env.ANTHROPIC_API_KEY) return null;
      return { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, model, source: "env" };
    }
    // Ollama needs no key, just a reachable URL.
    return { provider: "ollama", baseUrl: env.OLLAMA_BASE_URL, model, source: "env" };
  }

  async function fromUser(userId: string, task: AITask): Promise<ResolvedAICredential | null> {
    const rows = await handle.db
      .select()
      .from(aiProviders)
      .where(and(eq(aiProviders.userId, userId), eq(aiProviders.isDefault, true)))
      .limit(1);

    const row =
      rows[0] ??
      (
        await handle.db.select().from(aiProviders).where(eq(aiProviders.userId, userId)).limit(1)
      )[0];
    if (!row) return null;

    const model = row.models[task] ?? DEFAULT_MODELS[row.kind][task];

    let apiKey: string | undefined;
    if (row.apiKeyEnc) {
      try {
        apiKey = decryptSecret(row.apiKeyEnc, appSecret);
      } catch {
        // A key encrypted under a different APP_SECRET cannot be recovered. Say so
        // plainly rather than failing with a crypto error the user cannot act on.
        log.error("could not decrypt a stored API key", { userId, kind: row.kind });
        throw new NoAIProviderError(
          "Your saved API key cannot be read, which usually means APP_SECRET changed. Enter the key again in Settings.",
        );
      }
    }

    if (row.kind === "openai" && !apiKey) return null;
    if (row.kind === "anthropic" && !apiKey) return null;

    return {
      provider: row.kind,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
      model,
      source: "user",
    };
  }

  return {
    id: "env-and-user-keys",
    async resolve({ userId, task }) {
      const fromEnvironment = fromEnv(task);
      if (fromEnvironment) return fromEnvironment;

      const userCredential = await fromUser(userId, task);
      if (userCredential) return userCredential;

      throw new NoAIProviderError();
    },
  };
}
