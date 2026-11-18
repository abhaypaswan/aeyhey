// SPDX-License-Identifier: AGPL-3.0-only
// Links that were saved but never queued to be read.
//
// Saving a link writes the link, then queues its extract job. If the second step fails
// (a database error, a deploy in between), the link sits at "pending" for ever and the
// app shows it as still being read. The worker sweeps for those and queues them again.
// A link whose job is queued, running or finished is left alone: only a link with no
// job at all, after a few minutes, counts as stuck.

import { and, eq, lt, sql } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { enqueue, payloadField } from "./queue";
import { createLogger } from "../logger";

const log = createLogger("requeue");

/** Long enough that a link being saved right now is never caught half way. */
export const STUCK_AFTER_MS = 5 * 60 * 1000;

/** Queues the extract job for links that have none. Returns how many it queued. */
export async function requeueStuckLinks(handle: DbHandle, now = new Date()): Promise<number> {
  const { links, jobs } = handle.schema;
  const stuck = await handle.db
    .select({ id: links.id, userId: links.userId })
    .from(links)
    .where(
      and(
        eq(links.extractStatus, "pending"),
        lt(links.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
        sql`not exists (select 1 from ${jobs} where ${jobs.type} = 'extract_link' and ${payloadField(handle, "linkId")} = ${links.id})`,
      ),
    )
    .limit(50);
  for (const link of stuck) {
    await enqueue(handle, {
      type: "extract_link",
      userId: link.userId,
      payload: { linkId: link.id },
      dedupeKey: `extract:${link.id}`,
    });
  }
  if (stuck.length > 0) log.info("queued links that were never read", { count: stuck.length });
  return stuck.length;
}
