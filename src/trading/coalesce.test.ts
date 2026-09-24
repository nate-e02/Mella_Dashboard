import { describe, expect, it } from "vitest";
import { Coalescer } from "./coalesce";
import { parseChannel, parseClientMessage } from "./gateway";

describe("tick coalescing", () => {
  it("sends the first value immediately, queues the rest, and drains only the latest once the interval elapsed", () => {
    let now = 1000;
    const c = new Coalescer<number>(() => now);
    expect(c.offer("tick:EURUSD", 1, 100)).toBe(1);
    now += 10;
    expect(c.offer("tick:EURUSD", 2, 100)).toBeNull();
    now += 10;
    expect(c.offer("tick:EURUSD", 3, 100)).toBeNull();
    expect(c.pendingCount()).toBe(1);
    now += 50;
    expect(c.drain()).toEqual([]); // 70ms < 100ms
    now += 30;
    expect(c.drain()).toEqual([{ key: "tick:EURUSD", value: 3 }]);
    expect(c.pendingCount()).toBe(0);
    now += 100;
    expect(c.offer("tick:EURUSD", 4, 100)).toBe(4);
  });

  it("does not let a fresh key jump ahead of a pending value for the same key", () => {
    let now = 0;
    const c = new Coalescer<string>(() => now);
    expect(c.offer("a", "1", 100)).toBe("1");
    now = 50;
    expect(c.offer("a", "2", 100)).toBeNull();
    now = 150;
    expect(c.offer("a", "3", 100)).toBeNull(); // pending exists: keep ordering, drain will send "3"
    expect(c.drain()).toEqual([{ key: "a", value: "3" }]);
  });

  it("keeps keys independent with their own intervals", () => {
    let now = 0;
    const c = new Coalescer<number>(() => now);
    expect(c.offer("tick", 1, 100)).toBe(1);
    expect(c.offer("account", 1, 250)).toBe(1);
    now = 120;
    expect(c.offer("tick", 2, 100)).toBe(2);
    expect(c.offer("account", 2, 250)).toBeNull();
    now = 260;
    expect(c.drain()).toEqual([{ key: "account", value: 2 }]);
  });
});

describe("gateway parsing", () => {
  it("parses channel names", () => {
    expect(parseChannel("ticks:EURUSD")).toEqual({ kind: "ticks", symbol: "EURUSD" });
    expect(parseChannel("bars:XAUUSD:5m")).toEqual({ kind: "bars", symbol: "XAUUSD", tf: "5m" });
    expect(parseChannel("bars:XAUUSD:2m")).toBeNull();
    expect(parseChannel("account:abc")).toEqual({ kind: "account", accountId: "abc" });
    expect(parseChannel("market")).toEqual({ kind: "market" });
    expect(parseChannel("nope")).toBeNull();
  });

  it("validates client messages", () => {
    expect(parseClientMessage({ type: "ping" })).toEqual({ ok: true, message: { type: "ping" } });
    const order = parseClientMessage({ type: "order.place", accountId: "a", clientOrderId: "c1", symbol: "EURUSD", side: "BUY", orderType: "MARKET", volume: 0.1 });
    expect(order.ok).toBe(true);
    expect(parseClientMessage({ type: "order.place", accountId: "a", clientOrderId: "c1", symbol: "EURUSD", side: "LONG", orderType: "MARKET", volume: 0.1 }).ok).toBe(false);
    expect(parseClientMessage({ type: "subscribe", channels: new Array(51).fill("market") }).ok).toBe(false);
    expect(parseClientMessage({ type: "position.modify", accountId: "a", positionId: "p", stopLoss: null }).ok).toBe(true);
    expect(parseClientMessage("garbage").ok).toBe(false);
  });
});
