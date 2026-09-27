import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@/trading/protocol";
import { createTradingViewDatafeed, symbolInfoFor, toTvBar } from "./tradingViewDatafeed";

describe("TradingView datafeed over the existing market-data layer", () => {
  const instruments = [{ symbol: "EURUSD", displayName: "EUR/USD", category: "FOREX", digits: 5 }];

  function setup() {
    const handlers: ((m: ServerMessage) => void)[] = [];
    const socket = { subscribe: vi.fn(), unsubscribe: vi.fn(), onMessage: vi.fn((h: (m: ServerMessage) => void) => (handlers.push(h), () => handlers.splice(handlers.indexOf(h), 1))) };
    const fetchJson = vi.fn(async (url: string) => (url.startsWith("/api/market/instruments") ? instruments : [{ time: 1_790_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }])) as never;
    return { feed: createTradingViewDatafeed({ fetchJson, socket }), socket, handlers, fetchJson: fetchJson as unknown as ReturnType<typeof vi.fn> };
  }

  it("converts bar times to milliseconds and price scale from digits", () => {
    expect(toTvBar({ time: 1_790_000_000, open: 1, high: 1, low: 1, close: 1, volume: 0 }).time).toBe(1_790_000_000_000);
    expect(toTvBar({ time: 1_790_000_000_000, open: 1, high: 1, low: 1, close: 1, volume: 0 }).time).toBe(1_790_000_000_000);
    expect(symbolInfoFor(instruments[0]).pricescale).toBe(100_000);
  });

  it("loads history from /api/market/bars with our timeframe", async () => {
    const { feed, fetchJson } = setup();
    const info = symbolInfoFor(instruments[0]);
    const bars = await new Promise((resolve) => feed.getBars(info, "5", { from: 1_700_000_000, to: 1_790_000_100, countBack: 200, firstDataRequest: true }, resolve, () => resolve("error")));
    expect(fetchJson.mock.calls[0][0]).toBe("/api/market/bars?symbol=EURUSD&tf=5m&limit=200&before=1790000100");
    expect(bars).toEqual([{ time: 1_790_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }]);
  });

  it("streams live bars from the WebSocket bars channel and unsubscribes cleanly", () => {
    const { feed, socket, handlers } = setup();
    const info = symbolInfoFor(instruments[0]);
    const onTick = vi.fn();
    feed.subscribeBars(info, "1", onTick, "g1");
    expect(socket.subscribe).toHaveBeenCalledWith(["bars:EURUSD:1m"]);
    handlers.forEach((h) => h({ type: "bar", symbol: "EURUSD", tf: "1m", bar: { time: 1_790_000_040_000, open: 1, high: 1, low: 1, close: 1, volume: 1 } }));
    handlers.forEach((h) => h({ type: "bar", symbol: "EURUSD", tf: "5m", bar: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 } }));
    expect(onTick).toHaveBeenCalledTimes(1);
    feed.unsubscribeBars("g1");
    expect(socket.unsubscribe).toHaveBeenCalledWith(["bars:EURUSD:1m"]);
  });
});
