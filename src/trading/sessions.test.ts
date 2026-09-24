import { describe, expect, it } from "vitest";
import {
  dailyRollover,
  dailyRolloverCutoff,
  isRolloverWindow,
  isWeekendClosed,
  isWeekendRestricted,
  newYorkParts,
  newYorkWallTime,
  weekendCutoff,
  weekendReopen,
} from "./sessions";

// 2026 US DST: starts Sunday 8 March 02:00 (EST -5 -> EDT -4), ends Sunday 1 November 02:00.
const at = (iso: string) => new Date(iso).getTime();

describe("New York wall time", () => {
  it("resolves wall times on both sides of each DST change", () => {
    expect(newYorkWallTime(2026, 3, 6, 16, 45).toISOString()).toBe("2026-03-06T21:45:00.000Z"); // EST
    expect(newYorkWallTime(2026, 3, 8, 17, 0).toISOString()).toBe("2026-03-08T21:00:00.000Z"); // EDT, same day as the change
    expect(newYorkWallTime(2026, 10, 30, 16, 45).toISOString()).toBe("2026-10-30T20:45:00.000Z"); // EDT
    expect(newYorkWallTime(2026, 11, 1, 17, 0).toISOString()).toBe("2026-11-01T22:00:00.000Z"); // EST, same day as the change
  });

  it("reads weekday and time in New York", () => {
    expect(newYorkParts(at("2026-09-25T20:45:00Z"))).toMatchObject({ weekday: 5, hour: 16, minute: 45 });
    expect(newYorkParts(at("2026-09-26T03:59:00Z"))).toMatchObject({ weekday: 5, hour: 23, minute: 59 });
    expect(newYorkParts(at("2026-09-26T04:00:00Z"))).toMatchObject({ weekday: 6, hour: 0 });
  });
});

describe("weekend", () => {
  it("is closed from Friday 17:00 to Sunday 17:00 New York (summer)", () => {
    expect(isWeekendClosed(at("2026-09-25T20:59:59Z"))).toBe(false);
    expect(isWeekendClosed(at("2026-09-25T21:00:00Z"))).toBe(true);
    expect(isWeekendClosed(at("2026-09-27T20:59:59Z"))).toBe(true);
    expect(isWeekendClosed(at("2026-09-27T21:00:00Z"))).toBe(false);
  });

  it("is closed from Friday 17:00 to Sunday 17:00 New York (winter)", () => {
    expect(isWeekendClosed(at("2026-12-04T21:59:00Z"))).toBe(false);
    expect(isWeekendClosed(at("2026-12-04T22:00:00Z"))).toBe(true);
    expect(isWeekendClosed(at("2026-12-06T21:59:00Z"))).toBe(true);
    expect(isWeekendClosed(at("2026-12-06T22:00:00Z"))).toBe(false);
  });

  it("points at the coming Friday 16:45 during the week and the past one during the weekend", () => {
    expect(weekendCutoff(at("2026-09-21T12:00:00Z")).toISOString()).toBe("2026-09-25T20:45:00.000Z"); // Monday
    expect(weekendCutoff(at("2026-09-25T20:50:00Z")).toISOString()).toBe("2026-09-25T20:45:00.000Z"); // Friday after the cutoff
    expect(weekendCutoff(at("2026-09-26T12:00:00Z")).toISOString()).toBe("2026-09-25T20:45:00.000Z"); // Saturday
    expect(weekendCutoff(at("2026-09-27T20:00:00Z")).toISOString()).toBe("2026-09-25T20:45:00.000Z"); // Sunday before the open
    expect(weekendCutoff(at("2026-09-27T21:00:00Z")).toISOString()).toBe("2026-10-02T20:45:00.000Z"); // Sunday after the open
    expect(weekendReopen(at("2026-09-26T12:00:00Z")).toISOString()).toBe("2026-09-27T21:00:00.000Z");
  });

  it("restricts from Friday 16:45 to the Sunday open across the spring DST change", () => {
    // Friday 6 March is EST (16:45 = 21:45Z); the reopen on Sunday 8 March is already EDT (17:00 = 21:00Z).
    expect(isWeekendRestricted(at("2026-03-06T21:44:59Z"))).toBe(false);
    expect(isWeekendRestricted(at("2026-03-06T21:45:00Z"))).toBe(true);
    expect(weekendReopen(at("2026-03-07T12:00:00Z")).toISOString()).toBe("2026-03-08T21:00:00.000Z");
    expect(isWeekendRestricted(at("2026-03-08T20:59:59Z"))).toBe(true);
    expect(isWeekendRestricted(at("2026-03-08T21:00:00Z"))).toBe(false);
  });

  it("restricts from Friday 16:45 to the Sunday open across the autumn DST change", () => {
    // Friday 30 October is EDT (16:45 = 20:45Z); the reopen on Sunday 1 November is EST (17:00 = 22:00Z).
    expect(isWeekendRestricted(at("2026-10-30T20:44:59Z"))).toBe(false);
    expect(isWeekendRestricted(at("2026-10-30T20:45:00Z"))).toBe(true);
    expect(weekendCutoff(at("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-10-30T20:45:00.000Z");
    expect(isWeekendRestricted(at("2026-11-01T21:59:59Z"))).toBe(true);
    expect(isWeekendRestricted(at("2026-11-01T22:00:00Z"))).toBe(false);
  });
});

describe("daily rollover", () => {
  it("returns the most recent weekday 16:55 New York", () => {
    expect(dailyRolloverCutoff(at("2026-09-23T20:55:00Z")).toISOString()).toBe("2026-09-23T20:55:00.000Z"); // Wednesday, exactly
    expect(dailyRolloverCutoff(at("2026-09-23T20:54:59Z")).toISOString()).toBe("2026-09-22T20:55:00.000Z"); // just before -> Tuesday
    expect(dailyRolloverCutoff(at("2026-09-26T12:00:00Z")).toISOString()).toBe("2026-09-25T20:55:00.000Z"); // Saturday -> Friday
    expect(dailyRolloverCutoff(at("2026-09-28T12:00:00Z")).toISOString()).toBe("2026-09-25T20:55:00.000Z"); // Monday morning -> Friday
    expect(dailyRollover(at("2026-09-23T20:56:00Z")).toISOString()).toBe("2026-09-23T21:00:00.000Z");
  });

  it("follows DST: 20:55Z in summer, 21:55Z in winter", () => {
    expect(dailyRolloverCutoff(at("2026-03-06T22:00:00Z")).toISOString()).toBe("2026-03-06T21:55:00.000Z"); // Friday EST
    expect(dailyRolloverCutoff(at("2026-03-09T21:00:00Z")).toISOString()).toBe("2026-03-09T20:55:00.000Z"); // Monday EDT
    expect(dailyRolloverCutoff(at("2026-11-02T22:00:00Z")).toISOString()).toBe("2026-11-02T21:55:00.000Z"); // Monday EST
    expect(dailyRolloverCutoff(at("2026-11-02T21:00:00Z")).toISOString()).toBe("2026-10-30T20:55:00.000Z"); // before Monday's -> Friday EDT
  });

  it("marks the 16:55-17:00 window on weekdays only", () => {
    expect(isRolloverWindow(at("2026-03-09T20:54:59Z"))).toBe(false);
    expect(isRolloverWindow(at("2026-03-09T20:55:00Z"))).toBe(true);
    expect(isRolloverWindow(at("2026-03-09T20:59:59Z"))).toBe(true);
    expect(isRolloverWindow(at("2026-03-09T21:00:00Z"))).toBe(false);
    expect(isRolloverWindow(at("2026-03-02T21:57:00Z"))).toBe(true); // winter Monday
    expect(isRolloverWindow(at("2026-09-27T20:57:00Z"))).toBe(false); // Sunday
  });
});
