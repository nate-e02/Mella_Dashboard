import { describe, expect, it } from "vitest";
import { TraderMadeProvider, normalizeTmSymbol, parseTmTimestamp, parseTraderMadeMessage, tmBuild, traderMadeProtocolFor } from "./tradermade";
import type { FeedSymbol } from "./types";

const map = new Map<string, FeedSymbol>([
  ["EURUSD", { symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 }],
  ["XAUUSD", { symbol: "XAUUSD", feedSymbol: "XAUUSD", digits: 2 }],
]);
const NOW = Date.UTC(2026, 4, 15, 12, 36, 40);

describe("TraderMade encoding", () => {
  it("builds the login and subscribe frames of the current protocol", () => {
    expect(JSON.parse(tmBuild.login("k1"))).toEqual({ action: "login", key: "k1", fmt: "JSON" });
    expect(JSON.parse(tmBuild.subscribe(["EURUSD", "XAU/USD"]))).toEqual({ action: "subscribe", symbols: ["EURUSD:QUOTE", "XAUUSD:QUOTE"], send_last: true });
  });

  it("builds the legacy userKey subscription and picks the protocol from the URL", () => {
    expect(JSON.parse(tmBuild.legacySubscribe("k1", ["EURUSD", "GBPUSD"]))).toEqual({ userKey: "k1", symbol: "EURUSD,GBPUSD" });
    expect(traderMadeProtocolFor("wss://stream.tradermade.com/feedAdv")).toBe("v2");
    expect(traderMadeProtocolFor("wss://marketdata.tradermade.com/feedadv")).toBe("legacy");
    expect(normalizeTmSymbol("eur/usd:QUOTE")).toBe("EURUSD");
  });
});

describe("TraderMade decoding", () => {
  it("decodes a v2 QUOTE with string prices and a UTC server timestamp", () => {
    const msg = parseTraderMadeMessage('{"a":"1.162720000","av":"100000","b":"1.162700000","bv":"100000","s":"EURUSD","t":"QUOTE","ts":"20260515-12:36:35.588"}', map, NOW);
    expect(msg).toEqual({ kind: "tick", tick: { symbol: "EURUSD", bid: 1.1627, ask: 1.16272, ts: Date.UTC(2026, 4, 15, 12, 36, 35, 588), source: "TRADERMADE" } });
  });

  it("accepts LAST_QUOTE and rounds to the instrument digits", () => {
    const msg = parseTraderMadeMessage('{"t":"LAST_QUOTE","s":"XAUUSD","b":"2350.123","a":"2350.456","m":"2350.29","ts":"20260515-12:36:39.1"}', map, NOW);
    expect(msg.kind).toBe("tick");
    if (msg.kind === "tick") {
      expect(msg.tick).toMatchObject({ symbol: "XAUUSD", bid: 2350.12, ask: 2350.46 });
      expect(msg.tick.ts).toBe(Date.UTC(2026, 4, 15, 12, 36, 39, 100));
    }
  });

  it("decodes the legacy frame (numbers, epoch-seconds timestamp) and the Connected greeting", () => {
    const tsSec = Math.floor(NOW / 1000) - 2;
    const msg = parseTraderMadeMessage(`{"symbol":"EURUSD","ts":"${tsSec}","bid":1.21469,"ask":1.2147,"mid":1.2146949}`, map, NOW);
    expect(msg).toEqual({ kind: "tick", tick: { symbol: "EURUSD", bid: 1.21469, ask: 1.2147, ts: tsSec * 1000, source: "TRADERMADE" } });
    expect(parseTraderMadeMessage("Connected", map, NOW)).toEqual({ kind: "connected" });
  });

  it("falls back to the receipt time when the server clock is far off or missing", () => {
    const skewed = parseTraderMadeMessage('{"t":"QUOTE","s":"EURUSD","b":"1.1","a":"1.1001","ts":"20200101-00:00:00.000"}', map, NOW);
    expect(skewed.kind === "tick" && skewed.tick.ts).toBe(NOW);
    const missing = parseTraderMadeMessage('{"t":"QUOTE","s":"EURUSD","b":"1.1","a":"1.1001"}', map, NOW);
    expect(missing.kind === "tick" && missing.tick.ts).toBe(NOW);
  });

  it("decodes control messages", () => {
    expect(parseTraderMadeMessage('{"type":"login_ok","key":"x","fmt":"JSON","symbol_limit":54,"cfds":true}', map, NOW)).toEqual({ kind: "login_ok", symbolLimit: 54 });
    expect(parseTraderMadeMessage('{"accepted":["EURUSD:QUOTE"],"denied":["GBPUSD:QUOTE"],"denied_reasons":{},"invalid":["FOO:QUOTE"],"type":"sub_ack"}', map, NOW)).toEqual({
      kind: "sub_ack",
      accepted: ["EURUSD:QUOTE"],
      rejected: ["GBPUSD:QUOTE", "FOO:QUOTE"],
    });
    expect(parseTraderMadeMessage('{"type":"error","reason":"unknown_action"}', map, NOW)).toEqual({ kind: "error", reason: "unknown_action" });
  });

  it("ignores junk, unknown symbols, non-quote types and impossible prices", () => {
    for (const raw of [
      "",
      "not json",
      "{broken",
      "[1,2]",
      "null",
      '{"t":"QUOTE","s":"GBPUSD","b":"1.2","a":"1.3"}',
      '{"t":"TRADE","s":"EURUSD","b":"1.1","a":"1.2"}',
      '{"t":"QUOTE","s":"EURUSD","b":"abc","a":"1.2"}',
      '{"t":"QUOTE","s":"EURUSD","b":"0","a":"1.2"}',
      '{"t":"QUOTE","s":"EURUSD","b":"1.3","a":"1.2"}',
      '{"symbol":"EURUSD","bid":null,"ask":1.2}',
    ]) {
      expect(parseTraderMadeMessage(raw, map, NOW), raw).toEqual({ kind: "ignored" });
    }
  });

  it("parses timestamps defensively", () => {
    expect(parseTmTimestamp("20260515-12:36:35")).toBe(Date.UTC(2026, 4, 15, 12, 36, 35));
    expect(parseTmTimestamp(1_760_000_000_123)).toBe(1_760_000_000_123);
    expect(parseTmTimestamp("1760000000")).toBe(1_760_000_000_000);
    expect(parseTmTimestamp("garbage")).toBeNull();
    expect(parseTmTimestamp(undefined)).toBeNull();
  });

  it("does not connect without an API key", async () => {
    const p = new TraderMadeProvider({ apiKey: null });
    await p.start([{ symbol: "EURUSD", feedSymbol: "EURUSD", digits: 5 }]);
    expect(p.health()).toEqual({ connected: false, lastTickAt: null, symbols: { EURUSD: { lastTickAt: null } } });
    await p.stop();
  });
});
