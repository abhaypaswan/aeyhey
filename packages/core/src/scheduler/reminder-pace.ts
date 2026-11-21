// SPDX-License-Identifier: AGPL-3.0-only
// How often to remind someone who has stopped coming back.
//
// Questions that are never answered stay due, so without this an inactive account would
// get a reminder at every slot for ever. Counting the reminders sent since they last
// used the app:
//
//   - the first REMINDERS_BEFORE_WEEKLY go out on their own cadence,
//   - then one a week, whatever their cadence,
//   - and the last of WEEKLY_REMINDERS_BEFORE_STOP weekly ones says reminders are off.
//
// Any visit, answer or saved link resets the count, so the next slot is normal again.

export const REMINDERS_BEFORE_WEEKLY = 5;
export const WEEKLY_REMINDERS_BEFORE_STOP = 4;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ReminderPace = "normal" | "weekly" | "last";

export type PaceDecision =
  | { send: true; pace: ReminderPace }
  | { send: false; reason: "slowed to weekly" | "stopped until they come back" };

/**
 * [sentSince] is the slot time of every reminder sent since they were last active,
 * oldest first, one per slot however many channels it went to.
 */
export function reminderPace(sentSince: Date[], slot: Date): PaceDecision {
  const count = sentSince.length;
  if (count < REMINDERS_BEFORE_WEEKLY) return { send: true, pace: "normal" };
  if (count >= REMINDERS_BEFORE_WEEKLY + WEEKLY_REMINDERS_BEFORE_STOP) {
    return { send: false, reason: "stopped until they come back" };
  }

  const latest = sentSince[count - 1]!;
  // A little under a week, so a slot that drifts by minutes is not pushed a further week.
  if (slot.getTime() - latest.getTime() < WEEK_MS - 60 * 60 * 1000) {
    return { send: false, reason: "slowed to weekly" };
  }
  const last = count === REMINDERS_BEFORE_WEEKLY + WEEKLY_REMINDERS_BEFORE_STOP - 1;
  return { send: true, pace: last ? "last" : "weekly" };
}
