import { describe, expect, it } from "vitest";
import { currentDayStart, needsDailyReset, nextDayStart, parseResetTime, tradingDayKey } from "@/lib/services/dailyReset";

describe("parseResetTime", () => {
  it("parses named zones and numeric offsets", () => {
    expect(parseResetTime("00:00 EAT")).toEqual({ hour: 0, minute: 0, offsetMinutes: 180 });
    expect(parseResetTime("00:00 UTC")).toEqual({ hour: 0, minute: 0, offsetMinutes: 0 });
    expect(parseResetTime("21:30 +03:00")).toEqual({ hour: 21, minute: 30, offsetMinutes: 180 });
    expect(parseResetTime("05:00 -02:00")).toEqual({ hour: 5, minute: 0, offsetMinutes: -120 });
  });

  it("falls back to midnight EAT for garbage", () => {
    expect(parseResetTime("whenever")).toEqual({ hour: 0, minute: 0, offsetMinutes: 180 });
    expect(parseResetTime(undefined)).toEqual({ hour: 0, minute: 0, offsetMinutes: 180 });
  });
});

describe("currentDayStart / needsDailyReset", () => {
  const eat = parseResetTime("00:00 EAT");

  it("midnight EAT is 21:00 UTC the previous calendar day", () => {
    const now = new Date("2026-09-23T10:00:00Z"); // 13:00 EAT
    expect(currentDayStart(eat, now).toISOString()).toBe("2026-09-22T21:00:00.000Z");
    expect(nextDayStart(eat, now).toISOString()).toBe("2026-09-23T21:00:00.000Z");
  });

  it("just before the boundary still belongs to the previous day", () => {
    const now = new Date("2026-09-23T20:59:59Z");
    expect(currentDayStart(eat, now).toISOString()).toBe("2026-09-22T21:00:00.000Z");
    const after = new Date("2026-09-23T21:00:00Z");
    expect(currentDayStart(eat, after).toISOString()).toBe("2026-09-23T21:00:00.000Z");
  });

  it("flags an anchor captured before today's boundary as needing a reset, but not one captured after", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(needsDailyReset(new Date("2026-09-22T15:00:00Z"), eat, now)).toBe(true);
    expect(needsDailyReset(new Date("2026-09-22T21:00:00Z"), eat, now)).toBe(false);
    expect(needsDailyReset(new Date("2026-09-23T09:00:00Z"), eat, now)).toBe(false);
  });

  it("supports non-midnight reset times (e.g. 21:00 UTC like some firms)", () => {
    const rt = parseResetTime("21:00 UTC");
    expect(currentDayStart(rt, new Date("2026-09-23T20:00:00Z")).toISOString()).toBe("2026-09-22T21:00:00.000Z");
    expect(currentDayStart(rt, new Date("2026-09-23T21:30:00Z")).toISOString()).toBe("2026-09-23T21:00:00.000Z");
  });

  it("buckets trading days in the reset zone", () => {
    // 22:00 UTC on the 22nd is already the 23rd in EAT
    expect(tradingDayKey(new Date("2026-09-22T22:00:00Z"), eat)).toBe("2026-09-23");
    expect(tradingDayKey(new Date("2026-09-22T20:00:00Z"), eat)).toBe("2026-09-22");
  });
});
