// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  applyLinkAction,
  applyQuestionAction,
  describeInterval,
  describeNextDue,
  fromSnapshot,
  GRADE_THRESHOLDS,
  MAX_LINK_INTERVAL_DAYS,
  newCard,
  Rating,
  ratingFromScore,
  ratingToWord,
  retrievability,
  snapshot,
  State,
  undoToSnapshot,
  type SchedulableCard,
} from "../../src/scheduler/scheduler";

// Built from escapes, so this file holds no literal en or em dash of its own.
const DASHES = new RegExp("[\\u2013\\u2014]");

const DAY = 86_400_000;
const START = new Date("2026-01-01T09:00:00Z");
const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY);

describe("ratingFromScore", () => {
  it("maps the PRD 9.3 score bands", () => {
    expect(ratingFromScore(0)).toBe(Rating.Again);
    expect(ratingFromScore(39)).toBe(Rating.Again);
    expect(ratingFromScore(GRADE_THRESHOLDS.hard)).toBe(Rating.Hard);
    expect(ratingFromScore(64)).toBe(Rating.Hard);
    expect(ratingFromScore(GRADE_THRESHOLDS.good)).toBe(Rating.Good);
    expect(ratingFromScore(89)).toBe(Rating.Good);
    expect(ratingFromScore(GRADE_THRESHOLDS.easy)).toBe(Rating.Easy);
    expect(ratingFromScore(100)).toBe(Rating.Easy);
  });

  it("round trips through the word form the AI contract uses", () => {
    expect(ratingToWord(ratingFromScore(10))).toBe("again");
    expect(ratingToWord(ratingFromScore(50))).toBe("hard");
    expect(ratingToWord(ratingFromScore(70))).toBe("good");
    expect(ratingToWord(ratingFromScore(95))).toBe("easy");
  });
});

describe("question cards", () => {
  it("starts new and due now", () => {
    const card = newCard({ id: "c1", status: "new", now: START });
    expect(card.fsrsState).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.due.getTime()).toBe(START.getTime());
  });

  it("spaces out further on each Good, which is the whole point", () => {
    let card = newCard({ id: "c1", status: "new", now: START });
    let now = START;
    const intervals: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      const result = applyQuestionAction({
        card,
        action: { kind: "rate", rating: Rating.Good },
        now,
      });
      intervals.push(days(now, result.card.due));
      card = result.card;
      now = result.card.due;
    }

    expect(intervals[0]!).toBeLessThan(intervals[1]!);
    expect(intervals[1]!).toBeLessThan(intervals[2]!);
    // Fuzz is on, so assert the shape rather than exact days.
    expect(intervals[0]!).toBeGreaterThanOrEqual(1);
    expect(intervals[2]!).toBeGreaterThan(20);
    expect(card.status).toBe("active");
    expect(card.reps).toBe(3);
  });

  it("brings an Again card back sooner than a Good one", () => {
    const base = newCard({ id: "c1", status: "new", now: START });
    const again = applyQuestionAction({
      card: base,
      action: { kind: "rate", rating: Rating.Again },
      now: START,
    });
    const good = applyQuestionAction({
      card: base,
      action: { kind: "rate", rating: Rating.Good },
      now: START,
    });
    expect(again.card.due.getTime()).toBeLessThanOrEqual(good.card.due.getTime());
  });

  it("records an FSRS log on a rating and none on a skip", () => {
    const card = newCard({ id: "c1", status: "new", now: START });
    expect(
      applyQuestionAction({ card, action: { kind: "rate", rating: Rating.Good }, now: START })
        .fsrsLog,
    ).not.toBeNull();
    const nextSession = new Date(START.getTime() + DAY);
    expect(
      applyQuestionAction({
        card,
        action: { kind: "skip", nextSessionAt: nextSession },
        now: START,
      }).fsrsLog,
    ).toBeNull();
  });

  it("skips without touching the memory model and counts the skip", () => {
    const card = newCard({ id: "c1", status: "new", now: START });
    const nextSession = new Date(START.getTime() + DAY);
    const result = applyQuestionAction({
      card,
      action: { kind: "skip", nextSessionAt: nextSession },
      now: START,
    });

    expect(result.card.due.getTime()).toBe(nextSession.getTime());
    expect(result.card.skipCount).toBe(1);
    expect(result.card.reps).toBe(card.reps);
    expect(result.card.stability).toBe(card.stability);
    expect(result.card.fsrsState).toBe(card.fsrsState);
  });

  it("resets the skip count on any rating", () => {
    const card: SchedulableCard = {
      ...newCard({ id: "c1", status: "active", now: START }),
      skipCount: 2,
    };
    const result = applyQuestionAction({
      card,
      action: { kind: "rate", rating: Rating.Hard },
      now: START,
    });
    expect(result.card.skipCount).toBe(0);
  });

  it("suspends and unsuspends without losing FSRS state", () => {
    let card = applyQuestionAction({
      card: newCard({ id: "c1", status: "new", now: START }),
      action: { kind: "rate", rating: Rating.Good },
      now: START,
    }).card;
    const stability = card.stability;

    card = applyQuestionAction({ card, action: { kind: "suspend" }, now: START }).card;
    expect(card.status).toBe("suspended");
    expect(card.stability).toBe(stability);

    card = applyQuestionAction({ card, action: { kind: "unsuspend" }, now: START }).card;
    expect(card.status).toBe("active");
    expect(card.stability).toBe(stability);
  });

  it("honours a lower target retention with shorter intervals", () => {
    const card = newCard({ id: "c1", status: "new", now: START });
    const strict = applyQuestionAction({
      card,
      action: { kind: "rate", rating: Rating.Good },
      now: START,
      retention: 0.95,
    });
    const loose = applyQuestionAction({
      card,
      action: { kind: "rate", rating: Rating.Good },
      now: START,
      retention: 0.8,
    });
    expect(strict.card.due.getTime()).toBeLessThanOrEqual(loose.card.due.getTime());
  });
});

describe("link cards", () => {
  it("ends scheduling on Read now", () => {
    const card = newCard({ id: "l1", status: "unread", now: START });
    const result = applyLinkAction({ card, action: { kind: "read" }, now: START });
    expect(result.card.status).toBe("read");
    expect(result.fsrsLog).toBeNull();
  });

  it("pushes a repeatedly snoozed link further out each time, capped", () => {
    let card = newCard({ id: "l1", status: "unread", now: START });
    let now = START;
    const intervals: number[] = [];

    for (let i = 0; i < 6; i += 1) {
      const result = applyLinkAction({ card, action: { kind: "snooze", variant: "default" }, now });
      intervals.push(days(now, result.card.due));
      card = result.card;
      now = result.card.due;
      expect(card.status).toBe("snoozed");
    }

    expect(intervals[0]!).toBeLessThan(intervals[2]!);
    for (const interval of intervals) {
      expect(interval).toBeLessThanOrEqual(MAX_LINK_INTERVAL_DAYS + 5);
    }
  });

  it("orders the snooze variants from soonest to latest", () => {
    const card = newCard({ id: "l1", status: "unread", now: START });
    const tomorrow = applyLinkAction({
      card,
      action: { kind: "snooze", variant: "tomorrow" },
      now: START,
    });
    const normal = applyLinkAction({
      card,
      action: { kind: "snooze", variant: "default" },
      now: START,
    });
    const later = applyLinkAction({
      card,
      action: { kind: "snooze", variant: "much_later" },
      now: START,
    });

    expect(tomorrow.card.due.getTime()).toBeLessThanOrEqual(normal.card.due.getTime());
    expect(normal.card.due.getTime()).toBeLessThanOrEqual(later.card.due.getTime());
  });

  it("drops and expires without scheduling again", () => {
    const card = newCard({ id: "l1", status: "unread", now: START });
    expect(applyLinkAction({ card, action: { kind: "drop" }, now: START }).card.status).toBe(
      "dropped",
    );
    expect(applyLinkAction({ card, action: { kind: "expire" }, now: START }).card.status).toBe(
      "expired",
    );
  });

  it("restores an expired link as a clean card", () => {
    let card = newCard({ id: "l1", status: "unread", now: START });
    for (let i = 0; i < 4; i += 1) {
      card = applyLinkAction({
        card,
        action: { kind: "snooze", variant: "default" },
        now: card.due,
      }).card;
    }
    card = applyLinkAction({ card, action: { kind: "expire" }, now: START }).card;

    const restored = applyLinkAction({ card, action: { kind: "restore" }, now: START }).card;
    expect(restored.status).toBe("unread");
    expect(restored.fsrsState).toBe(State.New);
    expect(restored.reps).toBe(0);
    expect(restored.skipCount).toBe(0);
  });

  it("brings a read link back when the user asks", () => {
    const read = applyLinkAction({
      card: newCard({ id: "l1", status: "unread", now: START }),
      action: { kind: "read" },
      now: START,
    }).card;
    const back = applyLinkAction({ card: read, action: { kind: "bring_back" }, now: START }).card;
    expect(back.status).toBe("snoozed");
    expect(back.due.getTime()).toBeGreaterThan(START.getTime());
  });
});

describe("undo", () => {
  it("restores due, stability, difficulty, state and counters exactly", () => {
    const before = applyQuestionAction({
      card: newCard({ id: "c1", status: "new", now: START }),
      action: { kind: "rate", rating: Rating.Good },
      now: START,
    }).card;
    const snap = snapshot({ ...before, skipCount: 2 });

    const after = applyQuestionAction({
      card: before,
      action: { kind: "rate", rating: Rating.Again },
      now: before.due,
    }).card;
    expect(after.due.getTime()).not.toBe(before.due.getTime());

    const undone = undoToSnapshot("c1", snap);
    expect(undone.due.getTime()).toBe(before.due.getTime());
    expect(undone.stability).toBe(before.stability);
    expect(undone.difficulty).toBe(before.difficulty);
    expect(undone.fsrsState).toBe(before.fsrsState);
    expect(undone.reps).toBe(before.reps);
    expect(undone.lapses).toBe(before.lapses);
    expect(undone.skipCount).toBe(2);
  });

  it("survives a snapshot round trip", () => {
    const card = applyQuestionAction({
      card: newCard({ id: "c1", status: "new", now: START }),
      action: { kind: "rate", rating: Rating.Hard },
      now: START,
    }).card;
    expect(fromSnapshot("c1", snapshot(card))).toEqual(card);
  });
});

describe("retrievability", () => {
  it("is 0 for a new card and falls as a reviewed card ages", () => {
    const fresh = newCard({ id: "c1", status: "new", now: START });
    expect(retrievability(fresh, START)).toBe(0);

    const reviewed = applyQuestionAction({
      card: fresh,
      action: { kind: "rate", rating: Rating.Good },
      now: START,
    }).card;
    const atReview = retrievability(reviewed, START);
    const atDue = retrievability(reviewed, reviewed.due);
    const wellPastDue = retrievability(reviewed, new Date(reviewed.due.getTime() + 60 * DAY));

    expect(atReview).toBeGreaterThan(atDue);
    expect(atDue).toBeGreaterThan(wellPastDue);
    expect(wellPastDue).toBeGreaterThanOrEqual(0);
  });
});

describe("copy", () => {
  it("describes an interval in words a person would use", () => {
    expect(describeInterval(START, START)).toBe("Back in your next session");
    expect(describeInterval(START, new Date(START.getTime() + DAY))).toBe("Back tomorrow");
    expect(describeInterval(START, new Date(START.getTime() + 3 * DAY))).toBe("Back in 3 days");
    expect(describeInterval(START, new Date(START.getTime() + 10 * DAY))).toBe(
      "Back in about a week",
    );
    expect(describeInterval(START, new Date(START.getTime() + 21 * DAY))).toBe(
      "Back in about 3 weeks",
    );
    expect(describeInterval(START, new Date(START.getTime() + 45 * DAY))).toBe(
      "Back in about a month",
    );
    expect(describeInterval(START, new Date(START.getTime() + 120 * DAY))).toBe(
      "Back in about 4 months",
    );
  });

  it("says 'your next session' when FSRS is faster than the cadence (PRD 9.2)", () => {
    const nextSession = new Date(START.getTime() + 7 * DAY);
    expect(
      describeNextDue({
        from: START,
        due: new Date(START.getTime() + 2 * DAY),
        nextSessionAt: nextSession,
      }),
    ).toBe("Next time: your next session");
    expect(
      describeNextDue({
        from: START,
        due: new Date(START.getTime() + 30 * DAY),
        nextSessionAt: nextSession,
      }),
    ).toBe("Back in about a month");
  });

  it("contains no em dashes, which the project style forbids", () => {
    const samples = [
      describeInterval(START, new Date(START.getTime() + 10 * DAY)),
      applyLinkAction({
        card: newCard({ id: "l1", status: "unread", now: START }),
        action: { kind: "drop" },
        now: START,
      }).nextDueLabel,
    ];
    for (const sample of samples) expect(sample).not.toMatch(DASHES);
  });
});
