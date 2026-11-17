// SPDX-License-Identifier: AGPL-3.0-only
// What a job handler is given (PRD 10 jobs).

import type { DbHandle } from "../../db/client";
import type { Env } from "../../env";
import type { Registry } from "../../extensions/registry";
import type { AiCallDeps } from "../../ai/call";
import type { JobRecord } from "../queue";

export interface HandlerContext {
  handle: DbHandle;
  env: Env;
  registry: Registry;
  /** Built once per worker, so the rate limiter is shared across jobs. */
  ai: AiCallDeps;
  /**
   * The same secret the web app signs and verifies with. Read it from here, never from
   * process.env: when the secret was generated on first run, APP_SECRET is not set.
   */
  readonly appSecret: string;
  job: JobRecord;
}

export type JobHandler = (ctx: HandlerContext) => Promise<void>;

/** A job payload that is missing what it needs is a bug, not something to retry. */
export class BadJobPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadJobPayloadError";
  }
}

export function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value === "") {
    throw new BadJobPayloadError(`This job needs a ${key} in its payload.`);
  }
  return value;
}
