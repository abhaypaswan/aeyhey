// SPDX-License-Identifier: AGPL-3.0-only
// What /api/health reports (PRD 11 Ops).
//
// Lives here rather than in the route so apps/web needs no direct database dependency:
// the app layer stays thin, which is the whole point of the packages/core split.

import { desc, eq } from "drizzle-orm";
import type { DbHandle } from "./client";

/** A worker that has not written a beat in two minutes is not running. */
export const HEARTBEAT_STALE_MS = 2 * 60 * 1000;

export interface HealthReport {
  ok: boolean;
  db: boolean;
  worker: boolean;
  dialect: string | null;
  lastBeat: string | null;
  version: string;
}

export async function checkHealth(
  handle: DbHandle | null,
  version: string,
  now = Date.now(),
): Promise<HealthReport> {
  if (!handle) {
    return { ok: false, db: false, worker: false, dialect: null, lastBeat: null, version };
  }

  try {
    const { workerHeartbeat } = handle.schema;
    const rows = await handle.db
      .select()
      .from(workerHeartbeat)
      .where(eq(workerHeartbeat.id, "worker"))
      .orderBy(desc(workerHeartbeat.beatAt))
      .limit(1);

    const beat = rows[0]?.beatAt ?? null;

    return {
      // Healthy needs the database. A stopped worker is reported but not fatal: the web
      // app still works, it just will not send reminders.
      ok: true,
      db: true,
      worker: beat ? now - beat.getTime() < HEARTBEAT_STALE_MS : false,
      dialect: handle.dialect,
      lastBeat: beat ? beat.toISOString() : null,
      version,
    };
  } catch {
    return {
      ok: false,
      db: false,
      worker: false,
      dialect: handle.dialect,
      lastBeat: null,
      version,
    };
  }
}
