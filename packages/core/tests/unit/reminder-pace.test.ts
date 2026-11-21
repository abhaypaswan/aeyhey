// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { reminderPace } from "../../src/scheduler/reminder-pace";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2030-01-01T09:00:00Z");
const day = (n: number) => new Date(start.getTime() + n * DAY);

describe("reminder pace for someone who has not been back", () => {
  it("sends the first five on their own cadence", () => {
    for (let sent = 0; sent < 5; sent += 1) {
      const history = Array.from({ length: sent }, (_, i) => day(i));
      expect(reminderPace(history, day(sent))).toEqual({ send: true, pace: "normal" });
    }
  });

  it("then waits a week between reminders", () => {
    const five = [0, 1, 2, 3, 4].map(day);
    expect(reminderPace(five, day(5))).toEqual({ send: false, reason: "slowed to weekly" });
    expect(reminderPace(five, day(10))).toEqual({ send: false, reason: "slowed to weekly" });
    expect(reminderPace(five, day(11))).toEqual({ send: true, pace: "weekly" });
  });

  it("says the fourth weekly one is the last, and then stops", () => {
    const eight = [0, 1, 2, 3, 4, 11, 18, 25].map(day);
    expect(reminderPace(eight, day(32))).toEqual({ send: true, pace: "last" });
    const nine = [...eight, day(32)];
    expect(reminderPace(nine, day(100))).toEqual({
      send: false,
      reason: "stopped until they come back",
    });
  });
});
