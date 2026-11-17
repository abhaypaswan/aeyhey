// SPDX-License-Identifier: AGPL-3.0-only
// LocalUsageSink: the community default usage sink (PRD 23.4, 10).
//
// Writes one row to the public ai_usage table per AI call, which is what the stats page
// reads. This never leaves the machine: Aeyhey has no telemetry, and this table is the
// reason the stats page can exist without any.

import type { UsageSink } from "../usage";
import type { DbHandle } from "../../db/client";
import { createLogger } from "../../logger";

const log = createLogger("usage");

export function createLocalUsageSink(handle: DbHandle): UsageSink {
  const { aiUsage } = handle.schema;

  return {
    async record(event) {
      try {
        await handle.db
          .insert(aiUsage)
          .values({
            id: event.id,
            userId: event.userId,
            task: event.task,
            provider: event.provider,
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            credentialSource: event.credentialSource,
            jobId: event.jobId ?? null,
            refType: event.refType ?? null,
            refId: event.refId ?? null,
            ok: event.ok,
            error: event.error ?? null,
            createdAt: event.at,
          })
          .onConflictDoNothing();
      } catch (error) {
        // Losing a stats row must never fail the user's actual request.
        log.warn("could not record AI usage", { error: (error as Error).message });
      }
    },
  };
}
