// SPDX-License-Identifier: AGPL-3.0-only
// AI credential resolver (PRD 23.3).
//
// The AI layer never reads env vars or stored keys directly. It always calls resolve(),
// so the hosted edition can swap in server-side managed keys without touching prompts.

export type AITask = "summary" | "generate" | "grade" | "profile";

export type AIProviderKind = "openai" | "anthropic" | "ollama" | "mock";

export type CredentialSource = "env" | "user" | "managed";

export interface ResolvedAICredential {
  provider: AIProviderKind;
  baseUrl?: string;
  /** Never sent to the client, never logged. */
  apiKey?: string;
  model: string;
  source: CredentialSource;
}

export interface AIKeyProvider {
  id: string;
  resolve(ctx: { userId: string; task: AITask }): Promise<ResolvedAICredential>;
}

export class NoAIProviderError extends Error {
  readonly status = 400;
  readonly code = "no_ai_provider";
  constructor(
    message = "No AI provider is set up yet. Add one in Settings, or run Ollama locally.",
  ) {
    super(message);
    this.name = "NoAIProviderError";
  }
}
