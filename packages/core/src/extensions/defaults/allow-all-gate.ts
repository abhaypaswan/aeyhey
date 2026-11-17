// SPDX-License-Identifier: AGPL-3.0-only
// AllowAllGate: the community default usage gate (PRD 23.4).
//
// Self-hosters pay their own provider, so there is nothing to meter and nothing to refuse.
// The one thing this still does is respect the local concurrency and rate limits, because
// those protect the user's own API budget and a small Ollama box.

import type { UsageGate, UsageGateResult } from "../usage";

export interface AllowAllGateOptions {
  /** AI_RPM. Requests a minute across all tasks. */
  requestsPerMinute?: number;
}

export function createAllowAllGate(options: AllowAllGateOptions = {}): UsageGate {
  const limit = options.requestsPerMinute ?? 30;
  const recent: number[] = [];

  return {
    async check(): Promise<UsageGateResult> {
      const now = Date.now();
      const windowStart = now - 60_000;
      while (recent.length > 0 && recent[0]! <= windowStart) recent.shift();

      if (recent.length >= limit) {
        return {
          allow: false,
          reason: "rate_limited",
          message:
            "Aeyhey is making AI calls as fast as your rate limit allows. This will catch up on its own.",
        };
      }

      recent.push(now);
      return { allow: true };
    },
  };
}
