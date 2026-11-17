// SPDX-License-Identifier: AGPL-3.0-only
// The database-backed job queue (PRD 10 jobs, 15).
//
// No Redis in v1. A jobs table plus a polling worker is enough for one person's links,
// and it means a self-hoster runs two processes rather than four services.
//
// Claiming a job has to be atomic or two workers will do the same work:
//   SQLite:   one writer at a time, so UPDATE ... RETURNING on a single row is enough
//   Postgres: SELECT ... FOR UPDATE SKIP LOCKED, so several workers can run
//
// Failures back off exponentially. A refusal from the usage gate is not a failure: it
// becomes `blocked`, which is retried without burning an attempt (PRD 23.4).

import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { newId } from "../ids";
import type { DbHandle } from "../db/client";
import type { JobStatus, JobType } from "../db/types";
import { createLogger } from "../logger";

const log = createLogger("jobs");

export interface JobRecord {
  id: string;
  userId: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
  progressDone: number;
  progressTotal: number | null;
}

export interface EnqueueInput {
  type: JobType;
  payload: Record<string, unknown>;
  userId?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
  progressTotal?: number | null;
  /**
   * When set, an existing queued or running job with the same type and key is reused
   * rather than a second one being created. Stops a double click from fetching a page
   * twice.
   */
  dedupeKey?: string;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
/** How long a claimed job may run before another worker may take it back. */
export const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/** 30s, 2m, 8m: slow enough to outlast a brief provider outage. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 4 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
}

export async function enqueue(handle: DbHandle, input: EnqueueInput): Promise<string> {
  const { jobs } = handle.schema;
  const now = new Date();

  if (input.dedupeKey) {
    const existing = await handle.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, input.type),
          inArray(jobs.status, ["queued", "running", "blocked"]),
          sql`json_extract(${jobs.payload}, '$.dedupeKey') = ${input.dedupeKey}`,
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
  }

  const id = newId(now);
  await handle.db.insert(jobs).values({
    id,
    userId: input.userId ?? null,
    type: input.type,
    payload: input.dedupeKey ? { ...input.payload, dedupeKey: input.dedupeKey } : input.payload,
    status: "queued",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    runAfter: input.runAfter ?? now,
    progressDone: 0,
    progressTotal: input.progressTotal ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function enqueueMany(
  handle: DbHandle,
  inputs: readonly EnqueueInput[],
): Promise<string[]> {
  if (inputs.length === 0) return [];
  const { jobs } = handle.schema;
  const now = new Date();

  const rows = inputs.map((input) => ({
    id: newId(now),
    userId: input.userId ?? null,
    type: input.type,
    payload: input.payload,
    status: "queued" as JobStatus,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    runAfter: input.runAfter ?? now,
    progressDone: 0,
    progressTotal: input.progressTotal ?? null,
    createdAt: now,
    updatedAt: now,
  }));

  // One insert, because a big import enqueues thousands of these.
  await handle.db.insert(jobs).values(rows);
  return rows.map((row) => row.id);
}

/**
 * Claims one job for this worker, or returns null when there is nothing to do.
 * A job is claimable when it is queued or blocked and due, or when it has been running
 * longer than the claim timeout, which means the worker holding it died.
 */
export async function claimNextJob(
  handle: DbHandle,
  workerId: string,
  now = new Date(),
): Promise<JobRecord | null> {
  const { jobs } = handle.schema;
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  const claimable = or(
    and(inArray(jobs.status, ["queued", "blocked"]), lte(jobs.runAfter, now)),
    and(eq(jobs.status, "running"), lte(jobs.lockedAt, staleBefore)),
  )!;

  if (handle.dialect === "postgres") {
    // SKIP LOCKED lets several workers claim different rows at once without blocking.
    const rows = (await (
      handle.db as unknown as {
        execute(q: unknown): Promise<{ rows?: JobRecord[] } | JobRecord[]>;
      }
    ).execute(sql`
      UPDATE jobs SET status = 'running', locked_at = ${now}, locked_by = ${workerId},
        attempts = attempts + 1, updated_at = ${now}
      WHERE id = (
        SELECT id FROM jobs
        WHERE (status IN ('queued','blocked') AND run_after <= ${now})
           OR (status = 'running' AND locked_at <= ${staleBefore})
        ORDER BY run_after ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `)) as { rows?: Record<string, unknown>[] } | Record<string, unknown>[];

    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    const row = list[0];
    return row ? mapPgRow(row) : null;
  }

  // SQLite has a single writer, so reading the candidate and claiming it cannot
  // interleave with another worker's claim.
  const candidates = await handle.db
    .select()
    .from(jobs)
    .where(claimable)
    .orderBy(asc(jobs.runAfter))
    .limit(1);

  const candidate = candidates[0];
  if (!candidate) return null;

  const claimed = await handle.db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: now,
      lockedBy: workerId,
      attempts: candidate.attempts + 1,
      updatedAt: now,
    })
    // Including the current status in the predicate makes this a compare and swap, so a
    // second worker that read the same candidate cannot also claim it.
    .where(and(eq(jobs.id, candidate.id), eq(jobs.status, candidate.status)))
    .returning();

  const row = claimed[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    lastError: row.lastError,
    progressDone: row.progressDone,
    progressTotal: row.progressTotal,
  };
}

function mapPgRow(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row["id"]),
    userId: (row["user_id"] as string | null) ?? null,
    type: row["type"] as JobType,
    payload: (row["payload"] as Record<string, unknown>) ?? {},
    status: row["status"] as JobStatus,
    attempts: Number(row["attempts"] ?? 0),
    maxAttempts: Number(row["max_attempts"] ?? DEFAULT_MAX_ATTEMPTS),
    runAfter: new Date(row["run_after"] as string),
    lastError: (row["last_error"] as string | null) ?? null,
    progressDone: Number(row["progress_done"] ?? 0),
    progressTotal: (row["progress_total"] as number | null) ?? null,
  };
}

export async function completeJob(handle: DbHandle, jobId: string): Promise<void> {
  const { jobs } = handle.schema;
  await handle.db
    .update(jobs)
    .set({ status: "done", lockedAt: null, lockedBy: null, lastError: null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/** Retries with backoff while attempts remain, otherwise gives up and records why. */
export async function failJob(
  handle: DbHandle,
  job: JobRecord,
  error: unknown,
): Promise<{ willRetry: boolean }> {
  const { jobs } = handle.schema;
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  const willRetry = job.attempts < job.maxAttempts;

  await handle.db
    .update(jobs)
    .set({
      status: willRetry ? "queued" : "failed",
      runAfter: willRetry ? new Date(now.getTime() + backoffMs(job.attempts)) : job.runAfter,
      lockedAt: null,
      lockedBy: null,
      lastError: message.slice(0, 2000),
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id));

  if (willRetry) {
    log.info("job failed, will retry", { jobId: job.id, type: job.type, attempt: job.attempts });
  } else {
    log.error("job failed for good", { jobId: job.id, type: job.type, error: message });
  }

  return { willRetry };
}

/**
 * The usage gate refused this one. It is not a failure: the attempt is given back and the
 * job waits, so a top-up resumes everything without a manual re-queue (PRD 23.4).
 */
export async function blockJob(
  handle: DbHandle,
  job: JobRecord,
  reason: string,
  retryAfterMs = 15 * 60 * 1000,
): Promise<void> {
  const { jobs } = handle.schema;
  const now = new Date();

  await handle.db
    .update(jobs)
    .set({
      status: "blocked",
      // Give the attempt back: being out of credits must not use up the retries.
      attempts: Math.max(0, job.attempts - 1),
      runAfter: new Date(now.getTime() + retryAfterMs),
      lockedAt: null,
      lockedBy: null,
      lastError: reason.slice(0, 2000),
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id));

  log.info("job blocked by the usage gate", { jobId: job.id, type: job.type, reason });
}

export async function updateProgress(
  handle: DbHandle,
  jobId: string,
  done: number,
  total?: number | null,
): Promise<void> {
  const { jobs } = handle.schema;
  await handle.db
    .update(jobs)
    .set({
      progressDone: done,
      ...(total !== undefined ? { progressTotal: total } : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

export async function findJob(handle: DbHandle, jobId: string): Promise<JobRecord | null> {
  const { jobs } = handle.schema;
  const rows = await handle.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    lastError: row.lastError,
    progressDone: row.progressDone,
    progressTotal: row.progressTotal,
  };
}

/** Releases jobs a dead worker left claimed. Run at startup. */
export async function reclaimStaleJobs(handle: DbHandle, now = new Date()): Promise<number> {
  const { jobs } = handle.schema;
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  const stale = await handle.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, staleBefore)));

  if (stale.length === 0) return 0;

  await handle.db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, updatedAt: now })
    .where(
      inArray(
        jobs.id,
        stale.map((row) => row.id),
      ),
    );

  log.warn("reclaimed jobs from a worker that stopped", { count: stale.length });
  return stale.length;
}
