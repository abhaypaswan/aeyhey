// SPDX-License-Identifier: AGPL-3.0-only
// Topping up questions before each reminder.
//
// Questions are Aeyhey's to write, on a schedule. The user never asks for more. Shortly
// before each send slot the worker checks how many unseen question cards the user has
// across every deck, and writes only the shortfall against settings.maxNewQuestions, so a
// user who has not been doing their sessions does not pile up questions they will never
// see. A deck only gets new questions once every question it already has has been asked
// at least once, so a deck the user has not finished does not keep growing. The shortfall
// is shared between those finished decks, one at a time, earlier decks first.
//
// Each (user, slot) is queued at most once, ever, so a worker restart inside the lead
// window cannot write a second batch for the same reminder.

import { and, eq, sql } from "drizzle-orm";
import type { DbHandle } from "../db/client";
import { enqueue, payloadDedupeKey } from "../jobs/queue";
import { scopeFor } from "../repos/context";
import { loadSettings, toCadenceSettings } from "../repos/settings";
import { isPaused, nextSlot } from "../scheduler/cadence";
import { createLogger } from "../logger";

const log = createLogger("top-up");

/**
 * How long before a send slot the questions are written. Long enough for a slow real
 * model to finish a few batches before the reminder goes out.
 */
export const TOP_UP_LEAD_MS = 25 * 60 * 1000;

export const TOP_UP_JOB = "top_up_questions" as const;

export interface TopUpDeck {
  deckId: string;
  /** Unseen question cards in this deck right now. */
  unseen: number;
}

export interface TopUpPlanEntry {
  deckId: string;
  count: number;
}

/**
 * How many questions to write for each deck. `target` is the number of unseen question
 * cards the user should have across all decks; `unseenTotal` is how many they have,
 * counting decks that cannot be topped up too. Only `decks` (those with a source) with no
 * unseen question left get new ones, shared one at a time, the earlier deck first on a
 * tie. Pure, so the maths is cheap to test.
 */
export function planTopUp(input: {
  target: number;
  unseenTotal: number;
  decks: readonly TopUpDeck[];
}): TopUpPlanEntry[] {
  const shortfall = Math.max(0, Math.floor(input.target) - input.unseenTotal);
  // A deck still holding questions the user has never been asked is not finished.
  const finished = input.decks.filter((deck) => deck.unseen === 0);
  if (shortfall === 0 || finished.length === 0) return [];

  const current = finished.map((deck) => ({ ...deck, add: 0 }));
  for (let i = 0; i < shortfall; i += 1) current[i % current.length]!.add += 1;

  return current
    .filter((deck) => deck.add > 0)
    .map((deck) => ({ deckId: deck.deckId, count: deck.add }));
}

/** True when `now` is inside the lead window of `slot`, and the slot is still ahead. */
export function inTopUpWindow(now: Date, slot: Date, leadMs = TOP_UP_LEAD_MS): boolean {
  const ahead = slot.getTime() - now.getTime();
  return ahead > 0 && ahead <= leadMs;
}

export function topUpKey(userId: string, slot: Date): string {
  return `topup:${userId}:${slot.toISOString()}`;
}

/**
 * Whether a top-up job was ever queued for this key, in any status. queue.enqueue only
 * dedupes against jobs still waiting, which is not enough here: a finished top-up must
 * still stop a second one for the same slot.
 */
async function alreadyQueued(handle: DbHandle, key: string): Promise<boolean> {
  const { jobs } = handle.schema;
  const rows = await handle.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, TOP_UP_JOB), sql`${payloadDedupeKey(handle)} = ${key}`))
    .limit(1);
  return rows.length > 0;
}

/**
 * Runs every minute in the worker, next to the reminder loop. Queues one top_up_questions
 * job per user whose next slot is inside the lead window. Returns the users queued.
 */
export async function queueTopUps(options: {
  handle: DbHandle;
  now?: Date;
  leadMs?: number;
}): Promise<string[]> {
  const { handle } = options;
  const now = options.now ?? new Date();
  const { users } = handle.schema;
  const queued: string[] = [];

  const allUsers = await handle.db.select({ id: users.id }).from(users);
  for (const user of allUsers) {
    let settings;
    try {
      settings = await loadSettings(scopeFor(handle, user.id));
    } catch {
      continue;
    }
    const cadence = toCadenceSettings(settings);
    if (isPaused(now, cadence)) continue;

    const slot = nextSlot(now, cadence);
    if (!inTopUpWindow(now, slot, options.leadMs)) continue;

    const key = topUpKey(user.id, slot);
    if (await alreadyQueued(handle, key)) continue;

    await enqueue(handle, {
      type: TOP_UP_JOB,
      userId: user.id,
      payload: { slot: slot.toISOString() },
      dedupeKey: key,
    });
    queued.push(user.id);
  }

  if (queued.length > 0) log.info("queued question top-ups", { users: queued.length });
  return queued;
}
