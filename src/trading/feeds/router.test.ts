import { beforeEach, describe, expect, it } from "vitest";
import type { Tick } from "@/trading/protocol";
import { FeedRouter, type FeedSwitchEvent } from "./router";

/**
 * Drives the router with a fake clock: each `step` advances time and feeds
 * one tick per listed source, then runs the periodic evaluation exactly as
 * the worker's timer does.
 */

let clock = 0;
let router: FeedRouter;
let forwarded: Tick[];
let switches: FeedSwitchEvent[];

function tick(source: string, symbol = "EURUSD"): Tick {
  return { symbol, bid: 1.1, ask: 1.1001, ts: clock, source };
}

/** Advances `ms` in 500 ms steps; `sources` tick at every step. */
function run(ms: number, sources: string[], symbol = "EURUSD") {
  for (let elapsed = 0; elapsed < ms; elapsed += 500) {
    clock += 500;
    for (const s of sources) router.ingest(s, tick(s, symbol));
    router.evaluate();
  }
}

function forwardedSources(sinceIndex = 0) {
  return Array.from(new Set(forwarded.slice(sinceIndex).map((t) => t.source)));
}

beforeEach(() => {
  clock = 1_000_000;
  forwarded = [];
  switches = [];
  router = new FeedRouter({ now: () => clock, staleMs: 3_000, stableMs: 30_000 });
  router.onTick((t) => forwarded.push(t));
  router.onSwitch((e) => switches.push(e));
  router.setRoutes([{ symbol: "EURUSD", primary: "CTRADER", backup: "TRADERMADE" }]);
});

describe("FeedRouter", () => {
  it("forwards only the primary while it is healthy", () => {
    run(10_000, ["CTRADER", "TRADERMADE"]);
    expect(forwardedSources()).toEqual(["CTRADER"]);
    expect(forwarded).toHaveLength(20);
    expect(switches).toEqual([]);
    expect(router.state().EURUSD).toMatchObject({ active: "CTRADER", onBackup: false, primary: "CTRADER", backup: "TRADERMADE" });
  });

  it("fails over after staleMs of primary silence and hands over the backup price immediately", () => {
    run(5_000, ["CTRADER", "TRADERMADE"]);
    const mark = forwarded.length;
    const outageAt = clock;
    run(3_000, ["TRADERMADE"]); // exactly staleMs of silence: not yet
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(forwarded.length).toBe(mark);
    run(500, ["TRADERMADE"]); // 3.5 s > 3 s
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    expect(switches).toHaveLength(1);
    expect(switches[0]).toMatchObject({ symbol: "EURUSD", from: "CTRADER", to: "TRADERMADE", reason: "PRIMARY_STALE", at: outageAt + 3_500 });
    expect(forwardedSources(mark)).toEqual(["TRADERMADE"]);
    // The switching tick is forwarded exactly once.
    expect(forwarded.length).toBe(mark + 1);
    run(2_000, ["TRADERMADE"]);
    expect(forwarded.length).toBe(mark + 5);
  });

  it("fails back only after the primary has been continuously healthy for stableMs", () => {
    run(2_000, ["CTRADER", "TRADERMADE"]);
    run(4_000, ["TRADERMADE"]);
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    const recoveredAt = clock + 500;
    run(30_000, ["CTRADER", "TRADERMADE"]); // first primary tick at +0.5 s, so healthy for 29.5 s so far
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    const mark = forwarded.length;
    run(500, ["CTRADER", "TRADERMADE"]);
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(switches.map((s) => s.reason)).toEqual(["PRIMARY_STALE", "PRIMARY_RECOVERED"]);
    expect(switches[1].at - recoveredAt).toBe(30_000);
    expect(forwardedSources(mark)).toEqual(["CTRADER"]);
    expect(forwarded.length).toBe(mark + 1);
  });

  it("does not flap while the primary keeps dropping out", () => {
    run(2_000, ["CTRADER", "TRADERMADE"]);
    run(4_000, ["TRADERMADE"]); // failover
    // Primary flaps: 20 s up, 4 s down, repeated. Every gap > staleMs restarts the stable clock.
    for (let i = 0; i < 5; i += 1) {
      run(20_000, ["CTRADER", "TRADERMADE"]);
      run(4_000, ["TRADERMADE"]);
    }
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    expect(switches).toHaveLength(1);
    // Short gaps (<= staleMs) do not reset it: 2.5 s gaps every 10 s, then it fails back 30 s after it resumed.
    for (let i = 0; i < 3; i += 1) {
      run(10_000, ["CTRADER", "TRADERMADE"]);
      run(2_500, ["TRADERMADE"]);
    }
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(switches).toHaveLength(2);
  });

  it("stays put when both sources are dead and resumes whichever comes back first", () => {
    run(2_000, ["CTRADER", "TRADERMADE"]);
    const mark = forwarded.length;
    run(60_000, []);
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(switches).toEqual([]);
    expect(forwarded.length).toBe(mark);
    // Backup comes back first -> failover (primary still silent).
    run(500, ["TRADERMADE"]);
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    // Then the backup dies while the primary is back: go to the primary at once rather than wait for stability.
    run(1_000, ["CTRADER", "TRADERMADE"]);
    run(3_500, ["CTRADER"]);
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(switches.map((s) => s.reason)).toEqual(["PRIMARY_STALE", "BACKUP_STALE"]);
  });

  it("never switches without a backup and ignores sources outside the route", () => {
    router.setRoutes([{ symbol: "EURUSD", primary: "CTRADER", backup: null }]);
    run(2_000, ["CTRADER", "TRADERMADE"]);
    run(30_000, ["TRADERMADE"]);
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(forwardedSources()).toEqual(["CTRADER"]);
    expect(switches).toEqual([]);
    // Unknown symbols are dropped.
    expect(router.ingest("CTRADER", tick("CTRADER", "NOPE"))).toBe(false);
  });

  it("treats a backup equal to the primary as no backup", () => {
    router.setRoutes([{ symbol: "EURUSD", primary: "STUB", backup: "STUB" }]);
    expect(router.state().EURUSD.backup).toBeNull();
  });

  it("fails over at startup when the primary never ticks", () => {
    run(3_500, ["TRADERMADE"]);
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    expect(switches[0].primaryLastTickAt).toBeNull();
  });

  it("keeps an active failover across an unchanged route reload and resets on a changed one", () => {
    run(2_000, ["CTRADER", "TRADERMADE"]);
    run(4_000, ["TRADERMADE"]);
    router.setRoutes([{ symbol: "EURUSD", primary: "CTRADER", backup: "TRADERMADE" }, { symbol: "GBPUSD", primary: "CTRADER", backup: null }]);
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    expect(Object.keys(router.state()).sort()).toEqual(["EURUSD", "GBPUSD"]);
    router.setRoutes([{ symbol: "EURUSD", primary: "CTRADER", backup: "STUB2" }]);
    expect(router.activeSource("EURUSD")).toBe("CTRADER");
    expect(router.state().GBPUSD).toBeUndefined();
    expect(router.recentSwitches()[0]).toMatchObject({ reason: "PRIMARY_STALE" });
  });

  it("routes each symbol independently", () => {
    router.setRoutes([
      { symbol: "EURUSD", primary: "CTRADER", backup: "TRADERMADE" },
      { symbol: "XAUUSD", primary: "TRADERMADE", backup: "CTRADER" },
    ]);
    for (let i = 0; i < 4; i += 1) {
      clock += 500;
      for (const sym of ["EURUSD", "XAUUSD"]) for (const s of ["CTRADER", "TRADERMADE"]) router.ingest(s, tick(s, sym));
    }
    for (let i = 0; i < 8; i += 1) {
      clock += 500;
      for (const sym of ["EURUSD", "XAUUSD"]) router.ingest("TRADERMADE", tick("TRADERMADE", sym));
      router.evaluate();
    }
    expect(router.activeSource("EURUSD")).toBe("TRADERMADE");
    expect(router.activeSource("XAUUSD")).toBe("TRADERMADE");
    expect(switches.map((s) => s.symbol)).toEqual(["EURUSD"]);
  });
});
