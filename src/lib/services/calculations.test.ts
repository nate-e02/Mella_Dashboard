import { describe, expect, it } from "vitest";
import { computeAccountMetrics, currentDrawdownPercent, dailyDrawdownPercent, roundCurrency } from "@/lib/services/calculations";
import type { Trade } from "@prisma/client";

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: "t1",
    accountId: "a1",
    symbol: "EURUSD",
    side: "BUY",
    volume: 1,
    entryPrice: 1,
    exitPrice: 1,
    stopLoss: null,
    takeProfit: null,
    openTime: new Date("2026-01-01T00:00:00Z"),
    closeTime: new Date("2026-01-01T01:00:00Z"),
    profit: 0,
    commission: 0,
    swap: 0,
    netProfit: 0,
    status: "CLOSED",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("computeAccountMetrics", () => {
  it("returns zeroed metrics for an account with no trades", () => {
    const metrics = computeAccountMetrics(10000, []);
    expect(metrics.netPnl).toBe(0);
    expect(metrics.balance).toBe(10000);
    expect(metrics.equity).toBe(10000);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.tradingDays).toBe(0);
  });

  it("computes balance/equity/winRate for a single profitable trade", () => {
    const metrics = computeAccountMetrics(10000, [trade({ id: "1", netProfit: 500 })]);
    expect(metrics.netPnl).toBe(500);
    expect(metrics.balance).toBe(10500);
    expect(metrics.equity).toBe(10500);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.winRate).toBe(100);
    // No losses at all with at least one win -> "infinite" profit factor,
    // represented as null (displayed as "-" rather than a fake number).
    expect(metrics.profitFactor).toBeNull();
  });

  it("computes balance and failure-relevant figures for a single losing trade", () => {
    const metrics = computeAccountMetrics(10000, [trade({ id: "1", netProfit: -300 })]);
    expect(metrics.netPnl).toBe(-300);
    expect(metrics.balance).toBe(9700);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(1);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
  });

  it("aggregates many trades correctly, including profit factor and trading-day count", () => {
    const trades = [
      trade({ id: "1", netProfit: 200, openTime: new Date("2026-01-01T10:00:00Z"), closeTime: new Date("2026-01-01T11:00:00Z") }),
      trade({ id: "2", netProfit: -100, openTime: new Date("2026-01-01T14:00:00Z"), closeTime: new Date("2026-01-01T15:00:00Z") }),
      trade({ id: "3", netProfit: 300, openTime: new Date("2026-01-02T10:00:00Z"), closeTime: new Date("2026-01-02T11:00:00Z") }),
      trade({ id: "4", netProfit: -50, openTime: new Date("2026-01-03T10:00:00Z"), closeTime: new Date("2026-01-03T11:00:00Z") }),
    ];
    const metrics = computeAccountMetrics(10000, trades);
    expect(metrics.netPnl).toBe(350);
    expect(metrics.grossProfit).toBe(500);
    expect(metrics.grossLoss).toBe(150);
    expect(metrics.profitFactor).toBeCloseTo(500 / 150, 10);
    expect(metrics.winningTrades).toBe(2);
    expect(metrics.losingTrades).toBe(2);
    expect(metrics.winRate).toBe(50);
    // Trades close on 3 distinct calendar days, even though there are 4 trades.
    expect(metrics.tradingDays).toBe(3);
  });

  it("includes unrealized P&L from open trades in equity but not in balance", () => {
    const trades = [trade({ id: "1", status: "CLOSED", netProfit: 100 }), trade({ id: "2", status: "OPEN", profit: 40, netProfit: 0 })];
    const metrics = computeAccountMetrics(10000, trades);
    expect(metrics.balance).toBe(10100);
    expect(metrics.equity).toBe(10140);
    expect(metrics.openTrades).toBe(1);
    expect(metrics.closedTrades).toBe(1);
  });
});

describe("roundCurrency", () => {
  it("eliminates ordinary binary floating point noise at the cent boundary", () => {
    // 10000 * 0.08 is not exactly 800 in IEEE-754 binary floating point.
    expect(roundCurrency(10000 * (8 / 100))).toBe(800);
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  it("preserves genuine one-cent differences", () => {
    expect(roundCurrency(799.99)).toBe(799.99);
    expect(roundCurrency(800.01)).toBe(800.01);
  });
});

describe("currentDrawdownPercent / dailyDrawdownPercent", () => {
  it("is zero when equity is at or above the reference balance", () => {
    expect(currentDrawdownPercent(10000, 10000)).toBe(0);
    expect(currentDrawdownPercent(10000, 10500)).toBe(0);
    expect(dailyDrawdownPercent(10000, 10500)).toBe(0);
  });

  it("computes the percentage drop from the reference balance", () => {
    expect(currentDrawdownPercent(10000, 9000)).toBeCloseTo(10, 10);
    expect(dailyDrawdownPercent(10000, 9500)).toBeCloseTo(5, 10);
  });

  it("guards against a non-positive reference balance", () => {
    expect(currentDrawdownPercent(0, -100)).toBe(0);
    expect(dailyDrawdownPercent(-50, -100)).toBe(0);
  });
});
