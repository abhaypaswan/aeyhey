// SPDX-License-Identifier: AGPL-3.0-only
// Usage events and the pre-call gate (PRD 23.4).
//
// Community registers AllowAllGate and LocalUsageSink, which writes to the public
// ai_usage table for the stats page and makes no network calls. Hosted registers a
// credits-aware gate and sink.

import type { AITask, CredentialSource } from "./ai-credentials";

export interface AIUsageEvent {
  /** ULID. Doubles as the idempotency key. */
  id: string;
  userId: string;
  task: AITask;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  credentialSource: CredentialSource;
  jobId?: string;
  refType?: "link" | "question" | "question_source" | "grade";
  refId?: string;
  ok: boolean;
  error?: string;
  at: Date;
}

export type UsageBlockReason = "no_credits" | "rate_limited" | "disabled";

export type UsageGateResult =
  | { allow: true; reservationId?: string }
  | { allow: false; reason: UsageBlockReason; message: string };

export interface UsageGate {
  /** Called before every AI call. allow: false stops the call. */
  check(ctx: {
    userId: string;
    task: AITask;
    estimatedInputTokens: number;
    credentialSource: string;
  }): Promise<UsageGateResult>;
}

export interface UsageSink {
  /** Called after every AI call, success or failure. */
  record(event: AIUsageEvent & { reservationId?: string }): Promise<void>;
}

/**
 * A blocked call, not a failed one. Jobs that hit this are marked "blocked" and resume
 * when the gate allows them again, so a top-up does not mean re-queueing by hand.
 */
export class AIBlockedError extends Error {
  readonly status = 402;
  readonly code = "ai_blocked";
  constructor(
    readonly reason: UsageBlockReason,
    message: string,
    /** Where the UI should send the user, for example a billing page. */
    readonly actionHref?: string,
  ) {
    super(message);
    this.name = "AIBlockedError";
  }
}
