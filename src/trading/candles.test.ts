import { describe, expect, it } from "vitest";
import { CandleBuilder, aggregateBars, bucketStart } from "./candles";
import type { Tick } from "@/trading/protocol";

const T0 = Date.UTC(2026, 8, 23, 10, 0, 0); // 10:00:00 UTC, on a 1h/4h boundary? 10:00 is not 4h-aligned (08:00 is)
const tick = (ts: number, bid: number, ask = bid + 0.0002): Tick => ({ symbol: "EURUSD", bid, ask, ts, source: "TEST" });

describe("bucketStart", () => {
  it("floors to the timeframe boundary", () => {
    expect(bucketStart(T0 + 59_999, "1m")).toBe(T0);
    expect(bucketStart(T0 + 60_000, "1m")).toBe(T0 + 60_000);
    expect(bucketStart(T0 + 4 * 60_000 + 1, "5m")).toBe(T0);
    expect(bucketStart(T0 + 5 * 60_000, "5m")).toBe(T0 + 5 * 60_000);
    expect(bucketStart(T0, "4h")).toBe(Date.UTC(2026, 8, 23, 8));
    expect(bucketStart(T0, "1d")).toBe(Date.UTC(2026, 8, 23));
  });
});

describe("CandleBuilder", () => {
  it("builds OHLC from mid prices with tick-count volume across every timeframe", () => {
    const b = new CandleBuilder();
    b.setDigits("EURUSD", 5);
    b.onTick(tick(T0, 1.1));
    b.onTick(tick(T0 + 10_000, 1.101));
    const { updated, closed1m } = b.onTick(tick(T0 + 20_000, 1.0995));
    expect(closed1m).toBeNull();
    const m1 = updated.find((u) => u.tf === "1m")!.bar;
    expect(m1).toEqual({ time: T0, open: 1.1001, high: 1.1011, low: 1.0996, close: 1.0996, volume: 3 });
    expect(updated.map((u) => u.tf)).toEqual(["1m", "5m", "15m", "1h", "4h", "1d"]);
    expect(updated.find((u) => u.tf === "4h")!.bar.time).toBe(Date.UTC(2026, 8, 23, 8));
    expect(updated.find((u) => u.tf === "1d")!.bar.volume).toBe(3);
  });

  it("closes the 1m bar on a minute boundary and keeps the 5m bar running", () => {
    const b = new CandleBuilder();
    b.onTick(tick(T0, 1.1));
    b.onTick(tick(T0 + 30_000, 1.102));
    const r = b.onTick(tick(T0 + 60_000, 1.0999));
    expect(r.closed1m).toEqual({ time: T0, open: 1.1001, high: 1.1021, low: 1.1001, close: 1.1021, volume: 2 });
    const m1 = r.updated.find((u) => u.tf === "1m")!.bar;
    expect(m1).toEqual({ time: T0 + 60_000, open: 1.1, high: 1.1, low: 1.1, close: 1.1, volume: 1 });
    const m5 = r.updated.find((u) => u.tf === "5m")!.bar;
    expect(m5).toEqual({ time: T0, open: 1.1001, high: 1.1021, low: 1.1, close: 1.1, volume: 3 });
  });

  it("continues the open bars after a restart from stored 1m bars", () => {
    const stored = [
      { time: T0 - 120_000, open: 1.09, high: 1.095, low: 1.089, close: 1.094, volume: 10 },
      { time: T0 - 60_000, open: 1.094, high: 1.096, low: 1.093, close: 1.0955, volume: 12 },
      { time: T0, open: 1.0955, high: 1.097, low: 1.095, close: 1.096, volume: 4 },
    ];
    const b = new CandleBuilder();
    b.restore("EURUSD", stored);
    expect(b.current("EURUSD", "1m")).toEqual(stored[2]);
    expect(b.current("EURUSD", "5m")).toEqual({ time: T0, open: 1.0955, high: 1.097, low: 1.095, close: 1.096, volume: 4 });
    // 09:58 and 09:59 belong to the 09:00 hour; the current 1h bar is the 10:00 one.
    expect(b.current("EURUSD", "1h")).toEqual({ time: Date.UTC(2026, 8, 23, 10), open: 1.0955, high: 1.097, low: 1.095, close: 1.096, volume: 4 });
    // The 4h bucket (08:00-12:00) contains all three stored bars.
    expect(b.current("EURUSD", "4h")).toEqual({ time: Date.UTC(2026, 8, 23, 8), open: 1.09, high: 1.097, low: 1.089, close: 1.096, volume: 26 });

    // A tick 20 s into the same minute extends the restored bar instead of opening a new one.
    const r = b.onTick(tick(T0 + 20_000, 1.098));
    expect(r.closed1m).toBeNull();
    expect(r.updated.find((u) => u.tf === "1m")!.bar).toEqual({ time: T0, open: 1.0955, high: 1.0981, low: 1.095, close: 1.0981, volume: 5 });
    expect(r.updated.find((u) => u.tf === "1h")!.bar.volume).toBe(5);
    expect(r.updated.find((u) => u.tf === "4h")!.bar.volume).toBe(27);
  });

  it("ignores out-of-order ticks older than the current bar", () => {
    const b = new CandleBuilder();
    b.onTick(tick(T0 + 60_000, 1.1));
    const r = b.onTick(tick(T0, 1.2));
    // The 1m bar for T0 is already closed: ignored. Higher timeframes whose
    // bucket still contains T0 (5m and up) legitimately absorb the tick.
    expect(r.updated.map((u) => u.tf)).toEqual(["5m", "15m", "1h", "4h", "1d"]);
    expect(b.current("EURUSD", "1m")!.high).toBe(1.1001);
    expect(b.current("EURUSD", "5m")!.high).toBe(1.2001);
  });

  it("aggregateBars merges 1m bars into higher timeframes", () => {
    const bars = [
      { time: T0, open: 1, high: 3, low: 0.5, close: 2, volume: 1 },
      { time: T0 + 60_000, open: 2, high: 4, low: 1.5, close: 3.5, volume: 2 },
      { time: T0 + 5 * 60_000, open: 3.5, high: 3.6, low: 3, close: 3.1, volume: 1 },
    ];
    expect(aggregateBars(bars, "5m")).toEqual([
      { time: T0, open: 1, high: 4, low: 0.5, close: 3.5, volume: 3 },
      { time: T0 + 5 * 60_000, open: 3.5, high: 3.6, low: 3, close: 3.1, volume: 1 },
    ]);
  });
});
