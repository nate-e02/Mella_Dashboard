import { describe, expect, it } from "vitest";
import { bucketStart } from "@/lib/services/market";
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@/trading/protocol";

/**
 * Pure bucketing helper used by the bar aggregation and mirrored by the
 * terminal's live candle builder. Buckets are aligned to the UTC epoch, so a
 * "1d" bucket starts at 00:00:00 UTC and a "4h" bucket at 00/04/08/... UTC.
 */

const T = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("bucketStart", () => {
  it("floors to the bucket start for every timeframe", () => {
    const ts = T("2026-09-23T13:47:23Z");
    const expected: Record<Timeframe, string> = {
      "1m": "2026-09-23T13:47:00Z",
      "5m": "2026-09-23T13:45:00Z",
      "15m": "2026-09-23T13:45:00Z",
      "1h": "2026-09-23T13:00:00Z",
      "4h": "2026-09-23T12:00:00Z",
      "1d": "2026-09-23T00:00:00Z",
    };
    for (const tf of TIMEFRAMES) {
      expect(bucketStart(ts, tf), tf).toBe(T(expected[tf]));
    }
  });

  it("returns the timestamp itself on an exact boundary", () => {
    for (const tf of TIMEFRAMES) {
      const boundary = T("2026-09-24T00:00:00Z");
      expect(bucketStart(boundary, tf), tf).toBe(boundary);
      expect(bucketStart(boundary + TIMEFRAME_SECONDS[tf], tf), tf).toBe(boundary + TIMEFRAME_SECONDS[tf]);
    }
  });

  it("one second before a boundary belongs to the previous bucket", () => {
    for (const tf of TIMEFRAMES) {
      const boundary = T("2026-09-24T00:00:00Z");
      expect(bucketStart(boundary - 1, tf), tf).toBe(boundary - TIMEFRAME_SECONDS[tf]);
    }
  });

  it("keeps a late-evening timestamp on the same UTC day for 1d and in the last 4h block", () => {
    const ts = T("2026-09-23T23:59:59Z");
    expect(bucketStart(ts, "1d")).toBe(T("2026-09-23T00:00:00Z"));
    expect(bucketStart(ts, "4h")).toBe(T("2026-09-23T20:00:00Z"));
    expect(bucketStart(ts, "1h")).toBe(T("2026-09-23T23:00:00Z"));
    expect(bucketStart(ts, "15m")).toBe(T("2026-09-23T23:45:00Z"));
  });

  it("rolls into the next day exactly at midnight", () => {
    const midnight = T("2026-09-24T00:00:00Z");
    expect(bucketStart(midnight, "1d")).toBe(midnight);
    expect(bucketStart(midnight, "4h")).toBe(midnight);
  });

  it("bucket sizes divide a day evenly so daily buckets never straddle midnight", () => {
    for (const tf of TIMEFRAMES) expect(86_400 % TIMEFRAME_SECONDS[tf], tf).toBe(0);
  });

  it("groups consecutive minutes into the same 5m bucket and splits at the boundary", () => {
    const base = T("2026-09-23T10:00:00Z");
    const minutes = Array.from({ length: 12 }, (_, i) => base + i * 60);
    const buckets = minutes.map((m) => bucketStart(m, "5m"));
    expect(new Set(buckets).size).toBe(3);
    expect(buckets.slice(0, 5).every((b) => b === base)).toBe(true);
    expect(buckets.slice(5, 10).every((b) => b === base + 300)).toBe(true);
    expect(buckets.slice(10).every((b) => b === base + 600)).toBe(true);
  });
});
