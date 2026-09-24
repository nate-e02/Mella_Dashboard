import { describe, expect, it } from "vitest";
import type { InstrumentInfo } from "@/trading/protocol";
import { ruleNotices, ruleRestriction } from "./rules";

const inst = (symbol: string, category: InstrumentInfo["category"], base: string, quote: string): InstrumentInfo => ({
  symbol,
  displayName: symbol,
  category,
  baseCurrency: base,
  quoteCurrency: quote,
  digits: 5,
  contractSize: 100_000,
  minVolume: 0.01,
  maxVolume: 50,
  volumeStep: 0.01,
  commissionPerLot: 0,
});
const EURUSD = inst("EURUSD", "FOREX", "EUR", "USD");
const GBPJPY = inst("GBPJPY", "FOREX", "GBP", "JPY");
const BTCUSD = inst("BTCUSD", "CRYPTO", "BTC", "USD");
const strict = { weekendHoldingAllowed: false, overnightHoldingAllowed: false, newsTradingAllowed: false, consistencyLimitPercent: null };
const relaxed = { weekendHoldingAllowed: true, overnightHoldingAllowed: true, newsTradingAllowed: true, consistencyLimitPercent: null };
const at = (iso: string) => new Date(iso).getTime();
const T = at("2026-09-22T12:30:00Z");
const news = { windowMinutes: 2, events: [{ id: "nfp", title: "NFP", currency: "USD", scheduledAt: T }] };

describe("terminal rule mirror", () => {
  it("mirrors the engine: weekend and rollover block non-crypto, news blocks affected currencies", () => {
    expect(ruleRestriction(strict, EURUSD, null, at("2026-09-26T12:00:00Z"))).toEqual({ code: "WEEKEND_CLOSED", until: at("2026-09-27T21:00:00Z") });
    expect(ruleRestriction(strict, BTCUSD, null, at("2026-09-26T12:00:00Z"))).toBeNull();
    expect(ruleRestriction(strict, EURUSD, null, at("2026-09-23T20:56:00Z"))).toEqual({ code: "OVERNIGHT_CLOSED", until: at("2026-09-23T21:00:00Z") });
    expect(ruleRestriction(strict, EURUSD, news, T + 60_000)).toMatchObject({ code: "NEWS_WINDOW", until: T + 120_000 });
    expect(ruleRestriction(strict, GBPJPY, news, T)).toBeNull();
    expect(ruleRestriction(relaxed, EURUSD, news, T)).toBeNull();
  });

  it("announces news within the hour with affected symbols (selected first) and weekend/rollover ahead of time", () => {
    const notices = ruleNotices(strict, [EURUSD, GBPJPY, BTCUSD], news, T - 30 * 60_000, "BTCUSD");
    expect(notices).toEqual([{ kind: "news", active: false, event: news.events[0], start: T - 120_000, end: T + 120_000, symbols: ["BTCUSD", "EURUSD"] }]);
    expect(ruleNotices(strict, [EURUSD], news, T - 2 * 3_600_000)).toEqual([]);
    expect(ruleNotices(strict, [EURUSD], null, at("2026-09-25T19:00:00Z")).map((n) => [n.kind, n.active])).toEqual([["weekend", false]]);
    expect(ruleNotices(strict, [EURUSD], null, at("2026-09-26T12:00:00Z")).map((n) => [n.kind, n.active])).toEqual([["weekend", true]]);
    expect(ruleNotices(strict, [EURUSD], null, at("2026-09-23T20:30:00Z")).map((n) => [n.kind, n.active])).toEqual([["overnight", false]]);
    expect(ruleNotices(relaxed, [EURUSD], news, T)).toEqual([]);
  });
});
