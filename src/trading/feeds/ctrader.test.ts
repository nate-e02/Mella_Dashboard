import { describe, expect, it } from "vitest";
import { CT, build, decodeEnvelope, decodeSpotEvent, decodeSymbolsList, decodeTrendbars, matchSymbols, normalizeSymbolName, readCTraderConfigFromEnv, toInt, type QuoteCache } from "./ctrader";
import type { FeedSymbol } from "./types";

const cfg = { clientId: "cid", clientSecret: "sec", accessToken: "tok", accountId: 12345678, host: "demo.ctraderapi.com", port: 5036 };

describe("cTrader JSON encoding", () => {
  it("encodes ProtoOAApplicationAuthReq (2100) with clientId/clientSecret", () => {
    const frame = JSON.parse(build.applicationAuth(cfg, "m1"));
    expect(frame).toEqual({ clientMsgId: "m1", payloadType: 2100, payload: { clientId: "cid", clientSecret: "sec" } });
  });

  it("encodes ProtoOAAccountAuthReq (2102) with ctidTraderAccountId/accessToken", () => {
    const frame = JSON.parse(build.accountAuth(cfg, "m2"));
    expect(frame).toEqual({ clientMsgId: "m2", payloadType: 2102, payload: { ctidTraderAccountId: 12345678, accessToken: "tok" } });
  });

  it("encodes ProtoOASymbolsListReq (2114) and ProtoOASubscribeSpotsReq (2127)", () => {
    expect(JSON.parse(build.symbolsList(12345678, "m3"))).toEqual({
      clientMsgId: "m3",
      payloadType: 2114,
      payload: { ctidTraderAccountId: 12345678, includeArchivedSymbols: false },
    });
    expect(JSON.parse(build.subscribeSpots(12345678, [1, 41], "m4"))).toEqual({
      clientMsgId: "m4",
      payloadType: 2127,
      payload: { ctidTraderAccountId: 12345678, symbolId: [1, 41], subscribeToSpotTimestamp: true },
    });
  });

  it("encodes ProtoHeartbeatEvent (51) with an empty payload and no clientMsgId", () => {
    expect(JSON.parse(build.heartbeat())).toEqual({ payloadType: 51, payload: {} });
  });

  it("encodes ProtoOAGetTrendbarsReq (2137) with the right period enum values", () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2026, 0, 2);
    const frame = JSON.parse(build.getTrendbars(12345678, 1, "1h", from, to, "m5"));
    expect(frame).toEqual({
      clientMsgId: "m5",
      payloadType: 2137,
      payload: { ctidTraderAccountId: 12345678, fromTimestamp: from, toTimestamp: to, period: 9, symbolId: 1 },
    });
    expect(JSON.parse(build.getTrendbars(1, 1, "1m", 0, 1, "x")).payload.period).toBe(1);
    expect(JSON.parse(build.getTrendbars(1, 1, "5m", 0, 1, "x")).payload.period).toBe(5);
    expect(JSON.parse(build.getTrendbars(1, 1, "15m", 0, 1, "x")).payload.period).toBe(7);
    expect(JSON.parse(build.getTrendbars(1, 1, "4h", 0, 1, "x")).payload.period).toBe(10);
    expect(JSON.parse(build.getTrendbars(1, 1, "1d", 0, 1, "x")).payload.period).toBe(12);
  });
});

describe("cTrader JSON decoding", () => {
  const symbols = new Map<number, FeedSymbol>([
    [1, { symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 }],
    [41, { symbol: "XAUUSD", feedSymbol: "XAUUSD", digits: 2 }],
  ]);

  it("decodes the envelope and tolerates int64 values sent as strings", () => {
    const env = decodeEnvelope('{"clientMsgId":"a","payloadType":"2131","payload":{"symbolId":"1"}}');
    expect(env).toEqual({ clientMsgId: "a", payloadType: 2131, payload: { symbolId: "1" } });
    expect(decodeEnvelope("not json")).toBeNull();
    expect(toInt("12")).toBe(12);
    expect(toInt(undefined)).toBeNull();
  });

  it("decodes ProtoOASpotEvent (2131) bid/ask scaled by 1e5", () => {
    const cache: QuoteCache = new Map();
    const tick = decodeSpotEvent({ ctidTraderAccountId: 12345678, symbolId: 1, bid: 108455, ask: 108462, timestamp: 1_760_000_000_123 }, symbols, cache, 1);
    expect(tick).toEqual({ symbol: "EURUSD", bid: 1.08455, ask: 1.08462, ts: 1_760_000_000_123, source: "CTRADER" });
  });

  it("keeps the last known side when a spot event carries only bid or only ask", () => {
    const cache: QuoteCache = new Map();
    expect(decodeSpotEvent({ symbolId: 41, bid: 235012000 }, symbols, cache, 5)).toBeNull(); // no ask yet
    const t1 = decodeSpotEvent({ symbolId: 41, ask: 235042000 }, symbols, cache, 6);
    expect(t1).toEqual({ symbol: "XAUUSD", bid: 2350.12, ask: 2350.42, ts: 6, source: "CTRADER" });
    const t2 = decodeSpotEvent({ symbolId: 41, bid: "235020000" }, symbols, cache, 7);
    expect(t2?.bid).toBe(2350.2);
    expect(t2?.ask).toBe(2350.42);
    expect(t2?.ts).toBe(7); // no timestamp field -> receipt time
  });

  it("ignores spot events for unsubscribed symbols", () => {
    expect(decodeSpotEvent({ symbolId: 999, bid: 1, ask: 2 }, symbols, new Map())).toBeNull();
  });

  it("decodes ProtoOAGetTrendbarsRes (2138) trendbars from low + deltas", () => {
    const bars = decodeTrendbars(
      {
        ctidTraderAccountId: 12345678,
        period: 1,
        symbolId: 1,
        trendbar: [
          { volume: 42, period: 1, low: 108400, deltaOpen: 20, deltaHigh: 80, deltaClose: 55, utcTimestampInMinutes: 29_333_334 },
          { volume: "7", low: "108450", deltaOpen: "5", deltaHigh: "30", deltaClose: "0", utcTimestampInMinutes: "29333333" },
        ],
      },
      5,
    );
    expect(bars).toEqual([
      { time: 29_333_333 * 60_000, open: 1.08455, high: 1.0848, low: 1.0845, close: 1.0845, volume: 7 },
      { time: 29_333_334 * 60_000, open: 1.0842, high: 1.0848, low: 1.084, close: 1.08455, volume: 42 },
    ]);
  });

  it("maps ProtoOASymbolsListRes (2115) symbols by normalized name", () => {
    const list = decodeSymbolsList({
      symbol: [
        { symbolId: 1, symbolName: "EURUSD", enabled: true },
        { symbolId: "41", symbolName: "XAU/USD", enabled: true },
        { symbolId: 7, symbolName: "GBPUSD", enabled: false },
      ],
    });
    const { map, missing } = matchSymbols(list, [
      { symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 },
      { symbol: "XAUUSD", feedSymbol: "XAUUSD", digits: 2 },
      { symbol: "GBPUSD", feedSymbol: "GBPUSD", digits: 5 },
    ]);
    expect(Array.from(map.keys())).toEqual([1, 41]);
    expect(missing).toEqual(["GBPUSD"]);
    expect(normalizeSymbolName("eur/usd")).toBe("EURUSD");
  });

  it("does not start without full credentials", () => {
    expect(readCTraderConfigFromEnv({})).toBeNull();
    expect(readCTraderConfigFromEnv({ CTRADER_CLIENT_ID: "a", CTRADER_CLIENT_SECRET: "b", CTRADER_ACCESS_TOKEN: "c", CTRADER_ACCOUNT_ID: "nope" })).toBeNull();
    const c = readCTraderConfigFromEnv({ CTRADER_CLIENT_ID: "a", CTRADER_CLIENT_SECRET: "b", CTRADER_ACCESS_TOKEN: "c", CTRADER_ACCOUNT_ID: "77" });
    expect(c).toMatchObject({ accountId: 77, host: "demo.ctraderapi.com", port: 5036 });
    expect(CT.SPOT_EVENT).toBe(2131);
  });
});
