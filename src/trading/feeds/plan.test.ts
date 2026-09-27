import { describe, expect, it } from "vitest";
import { createProvider } from "./index";
import { effectiveBackupSource, effectiveFeedSource, planFeeds, subscriptionKey } from "./plan";

const inst = (symbol: string, feedSource: string, backupFeedSource: string | null = null, extra: Record<string, string> = {}) => ({
  symbol,
  feedSource,
  feedSymbol: extra.feedSymbol ?? symbol,
  backupFeedSource,
  backupFeedSymbol: extra.backupFeedSymbol ?? null,
  digits: 5,
});

describe("feed plan", () => {
  it("starts the union of primary and backup sources, with provider symbols per source", () => {
    const { routes, groups } = planFeeds(
      [inst("EURUSD", "CTRADER", "TRADERMADE", { backupFeedSymbol: "EUR/USD" }), inst("XAUUSD", "TRADERMADE", "CTRADER"), inst("BTCUSD", "BINANCE", null, { feedSymbol: "BTCUSDT" })],
      {},
    );
    expect(routes).toEqual([
      { symbol: "EURUSD", primary: "CTRADER", backup: "TRADERMADE" },
      { symbol: "XAUUSD", primary: "TRADERMADE", backup: "CTRADER" },
      { symbol: "BTCUSD", primary: "BINANCE", backup: null },
    ]);
    expect(groups.get("CTRADER")).toEqual([
      { symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 },
      { symbol: "XAUUSD", feedSymbol: "XAUUSD", digits: 5 },
    ]);
    expect(groups.get("TRADERMADE")).toEqual([
      { symbol: "EURUSD", feedSymbol: "EUR/USD", digits: 5 },
      { symbol: "XAUUSD", feedSymbol: "XAUUSD", digits: 5 },
    ]);
    expect(groups.get("BINANCE")).toEqual([{ symbol: "BTCUSD", feedSymbol: "BTCUSDT", digits: 5 }]);
  });

  it("selects providers from the instrument rows only (no environment override)", () => {
    const env = { FEED_SOURCES_OVERRIDE: "STUB", ALLOW_BINANCE: "false" };
    expect(effectiveFeedSource({ feedSource: "CTRADER" }, env)).toBe("CTRADER");
    expect(effectiveFeedSource({ feedSource: "binance" }, env)).toBe("BINANCE");
    expect(effectiveBackupSource({ feedSource: "CTRADER", backupFeedSource: "TRADERMADE" }, env)).toBe("TRADERMADE");
    // Development/CI rows set to the simulated feed keep STUB -> STUB2 failover.
    const { routes, groups } = planFeeds([inst("EURUSD", "STUB", "STUB2", { feedSymbol: "EUR/USD" })], env);
    expect(routes).toEqual([{ symbol: "EURUSD", primary: "STUB", backup: "STUB2" }]);
    expect(groups.get("STUB2")).toEqual([{ symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 }]);
  });

  it("never routes crypto through cTrader or TraderMade", () => {
    expect(effectiveBackupSource({ feedSource: "BINANCE", backupFeedSource: "TRADERMADE", category: "CRYPTO" }, {})).toBeNull();
    expect(effectiveBackupSource({ feedSource: "BINANCE", backupFeedSource: "CTRADER", category: "CRYPTO" }, {})).toBeNull();
    const { routes, groups } = planFeeds([{ ...inst("BTCUSD", "BINANCE", "TRADERMADE", { feedSymbol: "BTCUSDT" }), category: "CRYPTO" }], {});
    expect(routes).toEqual([{ symbol: "BTCUSD", primary: "BINANCE", backup: null }]);
    expect(groups.has("TRADERMADE")).toBe(false);
  });

  it("ignores blank or self-referencing backups and keys subscriptions by symbol and provider symbol", () => {
    expect(effectiveBackupSource({ feedSource: "CTRADER", backupFeedSource: " " }, {})).toBeNull();
    expect(effectiveBackupSource({ feedSource: "CTRADER", backupFeedSource: "ctrader" }, {})).toBeNull();
    expect(subscriptionKey([{ symbol: "B", feedSymbol: "b", digits: 5 }, { symbol: "A", feedSymbol: "a", digits: 5 }])).toBe("A=a,B=b");
  });

  it("creates distinct stub instances and the TraderMade provider", () => {
    expect(createProvider("STUB").name).toBe("STUB");
    expect(createProvider("stub2").name).toBe("STUB2");
    expect(createProvider("TRADERMADE").name).toBe("TRADERMADE");
    expect(() => createProvider("NOPE")).toThrow(/Unknown feed source/);
  });
});
