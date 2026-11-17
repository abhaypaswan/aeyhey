// SPDX-License-Identifier: AGPL-3.0-only
// Turning a resolved credential into a model the AI SDK can call (PRD 13, 15).
//
// On Ollama: rather than depend on a community provider that may or may not keep up, we
// talk to Ollama's own OpenAI-compatible endpoint at /v1 through @ai-sdk/openai. One less
// dependency, and structured output goes through the same code path as everything else.

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { ResolvedAICredential } from "../extensions/ai-credentials";
import { NoAIProviderError } from "../extensions/ai-credentials";
import { MOCK_MODEL_ID } from "./mock";

/** Marker the call wrapper checks for, so the mock never reaches the network. */
export interface ResolvedModel {
  model: LanguageModel | typeof MOCK_MODEL_ID;
  isMock: boolean;
  /** Ollama is slower, so timeouts are longer for it (PRD 13.4). */
  isLocal: boolean;
  providerLabel: string;
  modelId: string;
}

function ollamaBaseUrl(baseUrl: string | undefined): string {
  const root = (baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

/**
 * Every provider gets an explicit base URL, always.
 *
 * The AI SDK falls back to ANTHROPIC_BASE_URL and OPENAI_BASE_URL from the process
 * environment when it is not given one. Aeyhey must not inherit those. Two reasons, and
 * the second is the serious one:
 *
 *   1. It breaks for no visible reason. A machine with ANTHROPIC_BASE_URL set for some
 *      other tool produces a 404 that looks like a bad model name.
 *   2. It is a way for a user's API key to leave for a host nobody chose. An ambient
 *      variable set by anything else on the box would silently redirect every call, key
 *      included.
 *
 * A base URL is honoured only when it came from the resolved credential, which means the
 * operator put it in Aeyhey's own OPENAI_BASE_URL or the user typed it into Settings.
 */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function resolveModel(credential: ResolvedAICredential): ResolvedModel {
  switch (credential.provider) {
    case "mock":
      return {
        model: MOCK_MODEL_ID,
        isMock: true,
        isLocal: true,
        providerLabel: "mock",
        modelId: "mock",
      };

    case "openai": {
      if (!credential.apiKey) {
        throw new NoAIProviderError("That OpenAI-compatible provider has no API key set.");
      }
      const openai = createOpenAI({
        apiKey: credential.apiKey,
        // Explicit, never inherited from the environment. See the note above.
        baseURL: credential.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      });
      return {
        model: openai(credential.model),
        isMock: false,
        isLocal: false,
        providerLabel: "openai",
        modelId: credential.model,
      };
    }

    case "anthropic": {
      if (!credential.apiKey) {
        throw new NoAIProviderError("Your Anthropic provider has no API key set.");
      }
      const anthropic = createAnthropic({
        apiKey: credential.apiKey,
        // Explicit, never inherited from the environment. See the note above.
        baseURL: credential.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL,
      });
      return {
        model: anthropic(credential.model),
        isMock: false,
        isLocal: false,
        providerLabel: "anthropic",
        modelId: credential.model,
      };
    }

    case "ollama": {
      // Ollama ignores the key, but the SDK insists on one being present.
      const ollama = createOpenAI({
        apiKey: "ollama",
        baseURL: ollamaBaseUrl(credential.baseUrl),
      });
      return {
        model: ollama(credential.model),
        isMock: false,
        isLocal: true,
        providerLabel: "ollama",
        modelId: credential.model,
      };
    }
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Shown straight to the user on the Settings screen, so it has to read well. */
  message: string;
  modelId?: string;
}

/**
 * "Test connection" in Settings (PRD 8.4 FR-SET-2). Deliberately asks for something
 * tiny: the point is to prove the key, the URL and the model name all work together.
 */
export async function testConnection(
  credential: ResolvedAICredential,
): Promise<ConnectionTestResult> {
  if (credential.provider === "mock") {
    return {
      ok: true,
      message: "Mock provider is ready. No network calls will be made.",
      modelId: "mock",
    };
  }

  try {
    const { generateText } = await import("ai");
    const resolved = resolveModel(credential);
    const result = await generateText({
      model: resolved.model as LanguageModel,
      prompt: "Reply with the single word: ready",
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(resolved.isLocal ? 60_000 : 20_000),
    });
    return {
      ok: true,
      message: `Connected. ${resolved.providerLabel} answered with "${result.text.trim().slice(0, 40)}".`,
      modelId: resolved.modelId,
    };
  } catch (error) {
    return { ok: false, message: explainProviderError(error, credential) };
  }
}

/**
 * Provider errors are usually one of four things. Saying which one, in plain words,
 * saves the user a trip to the logs.
 */
export function explainProviderError(error: unknown, credential?: ResolvedAICredential): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("401") || lower.includes("unauthor") || lower.includes("invalid api key")) {
    return "That API key was rejected. Check you copied all of it, and that it is for the right provider.";
  }
  if (lower.includes("404") || lower.includes("model_not_found") || lower.includes("not found")) {
    return credential?.provider === "ollama"
      ? `Ollama does not have the model "${credential.model}". Pull it first with: ollama pull ${credential.model}`
      : `That provider does not have a model called "${credential?.model ?? "the one configured"}". Check the model name.`;
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) {
    return "The provider is rate limiting or out of quota. Aeyhey will retry on its own.";
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed") ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return credential?.provider === "ollama"
      ? `Could not reach Ollama at ${credential.baseUrl ?? "http://localhost:11434"}. Check it is running and that the URL is right from inside the container.`
      : "Could not reach the provider. Check the base URL and your network.";
  }
  return `The provider returned an error: ${raw.slice(0, 200)}`;
}
