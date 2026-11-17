// SPDX-License-Identifier: AGPL-3.0-only
// Concurrency and rate limiting for AI calls (PRD 13.5).
//
// AI_MAX_CONCURRENCY stops a 2,000 link import opening 2,000 sockets. AI_RPM keeps us
// inside the provider's per-minute limit. Both are enforced here, in the worker, which
// is the only place that makes AI calls in bulk.

export interface LimiterOptions {
  maxConcurrency: number;
  requestsPerMinute: number;
}

export class AiLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly recent: number[] = [];

  constructor(private readonly options: LimiterOptions) {}

  private pruneWindow(now: number): void {
    const windowStart = now - 60_000;
    while (this.recent.length > 0 && this.recent[0]! <= windowStart) this.recent.shift();
  }

  /** How long to wait before another call fits inside the per-minute limit. */
  private waitForRateMs(now: number): number {
    this.pruneWindow(now);
    if (this.recent.length < this.options.requestsPerMinute) return 0;
    const oldest = this.recent[0]!;
    return Math.max(0, oldest + 60_000 - now);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;

    try {
      for (;;) {
        const wait = this.waitForRateMs(Date.now());
        if (wait === 0) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5_000)));
      }
      this.recent.push(Date.now());
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  get stats(): { active: number; queued: number; inLastMinute: number } {
    this.pruneWindow(Date.now());
    return { active: this.active, queued: this.queue.length, inLastMinute: this.recent.length };
  }
}

let shared: AiLimiter | null = null;

export function sharedLimiter(options: LimiterOptions): AiLimiter {
  if (!shared) shared = new AiLimiter(options);
  return shared;
}

export function resetLimiterForTests(): void {
  shared = null;
}
