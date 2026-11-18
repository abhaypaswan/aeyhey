// SPDX-License-Identifier: AGPL-3.0-only
// The worker loop (PRD 15, 14.1).
//
// Polls the jobs table every 2 seconds, runs the reminder loop every minute, and writes a
// heartbeat that /api/health reports on. One process, no Redis, and it is the same image
// as the web app with a different command.
//
// Three rules the loop follows:
//   1. A job that throws is retried with backoff, up to its attempt limit.
//   2. A job refused by the usage gate becomes blocked, not failed, and does not use up
//      an attempt.
//   3. A bad payload is a bug, so it fails immediately rather than retrying three times.

import { hostname } from "node:os";
import type { DbHandle } from "../db/client";
import type { Env } from "../env";
import type { Registry } from "../extensions/registry";
import type { AiCallDeps } from "../ai/call";
import { AiLimiter } from "../ai/limiter";
import { AIBlockedError } from "../extensions/usage";
import { newId } from "../ids";
import { ensureAppSecret } from "../security/crypto";
import {
  blockJob,
  claimNextJob,
  completeJob,
  failJob,
  reclaimStaleJobs,
  type JobRecord,
} from "./queue";
import {
  BadJobPayloadError,
  CORE_HANDLERS,
  type HandlerContext,
  type JobHandler,
} from "./handlers/index";
import { buildChannels } from "../notify/channels";
import { runReminderLoop } from "../notify/reminder-loop";
import { queueTopUps } from "../questions/top-up";
import { queueDigests } from "../agent/digest";
import { enqueue } from "./queue";
import { requeueStuckLinks } from "./requeue";
import { createLogger } from "../logger";

const log = createLogger("worker");

export const POLL_INTERVAL_MS = 2_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
/** The reminder loop runs every minute, which is the finest cadence anyone can set. */
export const REMINDER_INTERVAL_MS = 60_000;
/** Expiry is a slow sweep over a pattern across days, so hourly is plenty. */
export const EXPIRY_INTERVAL_MS = 60 * 60 * 1000;

export interface WorkerOptions {
  handle: DbHandle;
  env: Env;
  registry: Registry;
  /** Stops after this many polls. Used by tests; production runs forever. */
  maxPolls?: number;
  pollIntervalMs?: number;
  /**
   * The app secret, needed by the channels that sign tokens. Left out, it is resolved the
   * same way the web app resolves it (APP_SECRET, else DATA_DIR/secrets.json), so links
   * the worker signs always verify in the web app.
   */
  appSecret?: string;
  /** false leaves the reminder loop and the expiry sweep out, which tests want. */
  periodicWork?: boolean;
}

export interface Worker {
  /** Runs until stop() is called, or until maxPolls is reached. */
  run(): Promise<void>;
  stop(): void;
  /** One poll and one job. Exposed so tests do not need the loop. */
  runOnce(): Promise<boolean>;
}

export function createWorker(options: WorkerOptions): Worker {
  const { handle, env, registry } = options;
  const workerId = `${hostname()}:${process.pid}:${newId().slice(-6)}`;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  // Resolved on first use, so a worker that never signs anything never touches DATA_DIR.
  let resolvedSecret: string | undefined = options.appSecret;
  const appSecret = (): string =>
    (resolvedSecret ??= ensureAppSecret({ dataDir: env.DATA_DIR, fromEnv: env.APP_SECRET }));

  // One limiter for the whole worker, so AI_MAX_CONCURRENCY and AI_RPM are real limits
  // across every job rather than per job.
  const ai: AiCallDeps = {
    keys: registry.aiKeys,
    gate: registry.usageGate,
    sink: registry.usageSink,
    limiter: new AiLimiter({
      maxConcurrency: env.AI_MAX_CONCURRENCY,
      requestsPerMinute: env.AI_RPM,
    }),
  };

  // Plugin handlers last, so the hosted edition can add types core knows nothing about.
  const handlers: Record<string, JobHandler> = { ...CORE_HANDLERS } as Record<string, JobHandler>;
  for (const plugin of registry.jobs) {
    handlers[plugin.type] = async (ctx) => plugin.handler(ctx.job.payload);
  }

  let stopped = false;
  let lastHeartbeat = 0;
  let lastReminderRun = 0;
  let lastExpiryRun = 0;

  async function heartbeat(): Promise<void> {
    const now = Date.now();
    if (now - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat = now;

    const { workerHeartbeat } = handle.schema;
    try {
      await handle.db
        .insert(workerHeartbeat)
        .values({
          id: "worker",
          beatAt: new Date(now),
          version: process.env.AEYHEY_VERSION ?? "0.1.0",
          hostname: workerId,
        })
        .onConflictDoUpdate({
          target: workerHeartbeat.id,
          set: { beatAt: new Date(now), hostname: workerId },
        });
    } catch (error) {
      // A missed heartbeat shows up as "worker: false" on the health endpoint. It must
      // never stop the worker doing actual work.
      log.warn("could not write the heartbeat", { error: (error as Error).message });
    }
  }

  /**
   * The time-based work: reminders and question top-ups every minute, the expiry sweep
   * every hour. Each is wrapped so a failure in one cannot stop the queue from draining,
   * which matters more than any of them.
   */
  async function periodic(): Promise<void> {
    if (options.periodicWork === false) return;
    const now = Date.now();

    if (now - lastReminderRun >= REMINDER_INTERVAL_MS) {
      lastReminderRun = now;
      try {
        const built = await buildChannels({
          handle,
          env,
          appSecret: appSecret(),
          pushSender: registry.pushSender,
        });
        await runReminderLoop({
          handle,
          channels: built.channels,
          publicUrl: env.PUBLIC_URL,
        });
      } catch (error) {
        log.error("the reminder loop failed", { error: (error as Error).message });
      }
      // Questions for the next slot are written ahead of it, so they are in that session.
      try {
        await queueTopUps({ handle });
      } catch (error) {
        log.error("could not queue the question top-ups", { error: (error as Error).message });
      }
      // A link whose job was never queued would show as being read for ever.
      try {
        await requeueStuckLinks(handle);
      } catch (error) {
        log.error("could not requeue stuck links", { error: (error as Error).message });
      }
      // A finished day of agent sessions becomes a few draft highlights (PRD 29.2).
      try {
        await queueDigests({ handle });
      } catch (error) {
        log.error("could not queue the agent digests", { error: (error as Error).message });
      }
    }

    if (now - lastExpiryRun >= EXPIRY_INTERVAL_MS) {
      lastExpiryRun = now;
      try {
        // Queued rather than run inline, so it goes through the same retry and logging
        // path as every other job.
        await enqueue(handle, {
          type: "expire_links",
          payload: {},
          dedupeKey: `expire:${new Date().toISOString().slice(0, 13)}`,
          once: true,
        });
      } catch (error) {
        log.error("could not queue the expiry sweep", { error: (error as Error).message });
      }
    }
  }

  async function runJob(job: JobRecord): Promise<void> {
    const handler = handlers[job.type];

    if (!handler) {
      await failJob(
        handle,
        { ...job, attempts: job.maxAttempts },
        new Error(`No handler is registered for job type "${job.type}".`),
      );
      return;
    }

    const ctx: HandlerContext = {
      handle,
      env,
      registry,
      ai,
      job,
      get appSecret() {
        return appSecret();
      },
    };

    try {
      await handler(ctx);
      await completeJob(handle, job.id);
      log.info("job done", { jobId: job.id, type: job.type });
    } catch (error) {
      if (error instanceof AIBlockedError) {
        await blockJob(handle, job, error.message);
        return;
      }
      if (error instanceof BadJobPayloadError) {
        // Retrying a malformed payload would fail the same way three times.
        await failJob(handle, { ...job, attempts: job.maxAttempts }, error);
        return;
      }
      await failJob(handle, job, error);
    }
  }

  return {
    async runOnce() {
      await heartbeat();
      await periodic();
      const job = await claimNextJob(handle, workerId);
      if (!job) return false;
      await runJob(job);
      return true;
    },

    stop() {
      stopped = true;
    },

    async run() {
      // Anything a previous worker left claimed when it died is given back.
      await reclaimStaleJobs(handle);
      log.info("worker running", { workerId, handlers: Object.keys(handlers) });

      let polls = 0;
      while (!stopped) {
        if (options.maxPolls !== undefined && polls >= options.maxPolls) break;
        polls += 1;

        let didWork = false;
        try {
          didWork = await this.runOnce();
        } catch (error) {
          // The loop itself must survive anything, or one bad poll stops reminders.
          log.error("the worker loop threw", { error: (error as Error).message });
        }

        // Sleep only when the queue was empty. A busy queue drains at full speed.
        if (!didWork && !stopped) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      }

      log.info("worker stopped", { workerId, polls });
    },
  };
}
