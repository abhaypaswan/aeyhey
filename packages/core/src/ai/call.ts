// SPDX-License-Identifier: AGPL-3.0-only
// The one function every AI call in Aeyhey goes through (PRD 13, 23.3, 23.4).
//
// It does six things in a fixed order, and the order is the point:
//   1. resolve a credential through the registry, never by reading env directly
//   2. ask the usage gate for permission, so the hosted edition can stop a call before
//      it costs anything
//   3. wait for the concurrency and rate limits
//   4. call the model with a Zod schema, retrying once with a repair prompt
//   5. record usage on the sink, whether the call worked or not
//   6. turn a refusal into AIBlockedError and a provider failure into a readable message

import { NoObjectGeneratedError, type LanguageModel } from "ai";
import type { z } from "zod";
import { CONTRACTS, TOKEN_BUDGETS, type ContractName } from "./contracts/index";
import { resolveModel, explainProviderError } from "./providers";
import { mockObjectFor, mockUsage } from "./mock";
import type { AiLimiter } from "./limiter";
import { estimateTokens, repairPrompt } from "./prompts/shared";
import { AIBlockedError, type UsageGate, type UsageSink } from "../extensions/usage";
import type { AIKeyProvider, AITask } from "../extensions/ai-credentials";
import { newId } from "../ids";
import { createLogger } from "../logger";

const log = createLogger("ai");

/** Which task each contract bills against, for credentials and metering. */
const CONTRACT_TASK: Record<ContractName, AITask> = {
  link_summary: "summary",
  resume_profile: "profile",
  generate_questions: "generate",
  grade_answer: "grade",
  // Reading a document to understand it, the same kind of work as reading a resume.
  document_intent: "profile",
  // Summing up a day of work is summary work, so it bills like a link summary.
  agent_digest: "summary",
  // Reading a message and answering from a few saved pieces: short, summary-sized work.
  assistant_intent: "summary",
  library_answer: "summary",
  // A chat answer: one call per message, sized like a short summary.
  assistant_turn: "summary",
};

export interface AiCallDeps {
  keys: AIKeyProvider;
  gate: UsageGate;
  sink: UsageSink;
  limiter: AiLimiter;
}

export interface AiCallInput<N extends ContractName> {
  contract: N;
  userId: string;
  system: string;
  prompt: string;
  /** Linked on the usage row so a cost can be traced back to a card. */
  ref?: { type: "link" | "question" | "question_source" | "grade"; id: string };
  jobId?: string;
  /** Overrides the contract's default, for a model that needs more room. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiCallResult<T> {
  object: T;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** True when a repair retry was needed, which is worth knowing in the logs. */
  repaired: boolean;
}

export class AiContractError extends Error {
  readonly status = 502;
  readonly code = "ai_contract_failed";
  constructor(
    readonly contract: ContractName,
    message: string,
  ) {
    super(message);
    this.name = "AiContractError";
  }
}

export class AiProviderError extends Error {
  readonly status = 502;
  readonly code = "ai_provider_failed";
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

export async function callAi<N extends ContractName>(
  deps: AiCallDeps,
  input: AiCallInput<N>,
): Promise<AiCallResult<z.infer<(typeof CONTRACTS)[N]>>> {
  type Output = z.infer<(typeof CONTRACTS)[N]>;

  const task = CONTRACT_TASK[input.contract];
  // CONTRACTS is a union of schema types and N narrows it only at the call site, so the
  // cast goes through unknown. The runtime safeParse below is what actually guarantees
  // the shape, so nothing rests on this line being clever.
  const schema = CONTRACTS[input.contract] as unknown as z.ZodType<Output>;
  const budget = TOKEN_BUDGETS[input.contract];

  const credential = await deps.keys.resolve({ userId: input.userId, task });
  const resolved = resolveModel(credential);
  const estimatedInputTokens = estimateTokens(`${input.system}\n${input.prompt}`);

  // Ask before spending. A refusal is not an error in the provider sense: the job that
  // hit it is marked blocked and picks up again once the gate allows it.
  const verdict = await deps.gate.check({
    userId: input.userId,
    task,
    estimatedInputTokens,
    credentialSource: credential.source,
  });
  if (!verdict.allow) {
    log.info("usage gate refused an AI call", { task, reason: verdict.reason });
    throw new AIBlockedError(verdict.reason, verdict.message, verdict.actionHref);
  }

  const usageId = newId();
  const timeoutMs = resolved.isLocal ? budget.ollamaTimeoutMs : budget.timeoutMs;

  const record = async (patch: {
    ok: boolean;
    inputTokens: number;
    outputTokens: number;
    error?: string;
  }): Promise<void> => {
    await deps.sink.record({
      id: usageId,
      userId: input.userId,
      task,
      provider: resolved.providerLabel,
      model: resolved.modelId,
      inputTokens: patch.inputTokens,
      outputTokens: patch.outputTokens,
      credentialSource: credential.source,
      ok: patch.ok,
      at: new Date(),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.ref ? { refType: input.ref.type, refId: input.ref.id } : {}),
      ...(patch.error ? { error: patch.error } : {}),
      ...(verdict.reservationId ? { reservationId: verdict.reservationId } : {}),
    });
  };

  // Demo mode and tests stop here. No network, no SDK, same validation.
  if (resolved.isMock) {
    const raw = mockObjectFor(input.contract, input.prompt);
    const parsed = schema.safeParse(raw);
    const usage = mockUsage(input.prompt);
    if (!parsed.success) {
      await record({ ok: false, ...usage, error: parsed.error.message });
      throw new AiContractError(
        input.contract,
        `The mock provider produced invalid output: ${parsed.error.message}`,
      );
    }
    await record({ ok: true, ...usage });
    return {
      object: parsed.data,
      model: "mock",
      provider: "mock",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      repaired: false,
    };
  }

  const { generateObject } = await import("ai");

  const attempt = async (
    prompt: string,
  ): Promise<{ object: unknown; inputTokens: number; outputTokens: number }> => {
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    // generateObject infers its result from the schema. We already know the type from
    // the contract and re-parse below, so the schema goes in widened and the result
    // comes out as unknown.
    const result = await generateObject({
      model: resolved.model as LanguageModel,
      schema: schema as z.ZodType<unknown>,
      system: input.system,
      prompt,
      maxOutputTokens: input.maxOutputTokens ?? budget.maxOutputTokens,
      // No temperature on purpose. Some models reject the setting outright (Claude Haiku
      // 5.5 among them) and the SDK only warns and drops it, so setting it bought us
      // nothing except a warning on every call.
      abortSignal: signal,
    });

    return {
      object: result.object,
      inputTokens: result.usage?.inputTokens ?? estimatedInputTokens,
      outputTokens: result.usage?.outputTokens ?? 0,
    };
  };

  let lastError: unknown;
  let tokensIn = estimatedInputTokens;
  let tokensOut = 0;

  for (const [index, prompt] of [input.prompt, null].entries()) {
    const isRepair = prompt === null;
    try {
      const promptToSend = isRepair
        ? repairPrompt(
            lastError instanceof NoObjectGeneratedError
              ? (lastError.text ?? "")
              : String(lastError),
            lastError instanceof Error ? lastError.message : String(lastError),
          )
        : prompt;

      const outcome = await deps.limiter.run(() => attempt(promptToSend));
      tokensIn = outcome.inputTokens;
      tokensOut = outcome.outputTokens;

      // generateObject validates against the schema, but we parse again so transforms
      // such as whitespace tidying actually apply to what we store.
      const parsed = schema.safeParse(outcome.object);
      if (!parsed.success) throw new AiContractError(input.contract, parsed.error.message);

      await record({ ok: true, inputTokens: tokensIn, outputTokens: tokensOut });
      if (isRepair) log.info("a repair retry fixed the output", { contract: input.contract });

      return {
        object: parsed.data,
        model: resolved.modelId,
        provider: resolved.providerLabel,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        repaired: isRepair,
      };
    } catch (error) {
      lastError = error;

      // A schema problem is worth one repair attempt. A refused key or an unreachable
      // host is not: retrying would just cost another call.
      const worthRepairing =
        error instanceof AiContractError || error instanceof NoObjectGeneratedError;
      if (index === 0 && worthRepairing) {
        log.warn("AI output did not match the schema, retrying once with a repair prompt", {
          contract: input.contract,
          error: (error as Error).message.slice(0, 200),
        });
        continue;
      }
      break;
    }
  }

  const message =
    lastError instanceof AiContractError
      ? `The model could not produce valid ${input.contract} output, even after a repair attempt.`
      : explainProviderError(lastError, credential);

  await record({ ok: false, inputTokens: tokensIn, outputTokens: tokensOut, error: message });

  throw lastError instanceof AiContractError
    ? new AiContractError(input.contract, message)
    : new AiProviderError(message);
}
