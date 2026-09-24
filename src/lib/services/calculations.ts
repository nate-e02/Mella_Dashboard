import type { Trade } from "@prisma/client";

export type AccountMetrics = {
  netPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  balance: number;
  equity: number;
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  totalVolume: number;
  grossProfit: number;
  grossLoss: number;
  tradingDays: number;
};

type TradeLike = Pick<Trade, "status" | "netProfit" | "profit" | "volume" | "openTime" | "closeTime"> & { archivedAt?: Date | null };

/**
 * Pure calculation of account performance metrics from an in-memory trade
 * list. Used for bounded lists (recent trades, unit tests); the engine and the
 * account pages use the SQL-aggregated equivalent in accountMetrics.ts so an
 * account with a million trades is never loaded into memory.
 */
export function computeAccountMetrics(startingBalance: number, trades: TradeLike[]): AccountMetrics {
  let closedCount = 0;
  let openCount = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalVolume = 0;
  const days = new Set<string>();

  for (const t of trades) {
    if (t.archivedAt) continue;
    totalVolume += t.volume;
    if (t.status === "CLOSED") {
      closedCount += 1;
      realizedPnl += t.netProfit;
      if (t.netProfit > 0) {
        wins += 1;
        grossProfit += t.netProfit;
        if (t.netProfit > largestWin) largestWin = t.netProfit;
      } else if (t.netProfit < 0) {
        losses += 1;
        grossLoss += -t.netProfit;
        if (t.netProfit < largestLoss) largestLoss = t.netProfit;
      }
      days.add((t.closeTime ?? t.openTime).toISOString().slice(0, 10));
    } else {
      openCount += 1;
      unrealizedPnl += t.profit;
    }
  }

  const balance = startingBalance + realizedPnl;
  const equity = balance + unrealizedPnl;
  const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : wins > 0 ? null : 0;

  return {
    netPnl: realizedPnl,
    realizedPnl,
    unrealizedPnl,
    balance,
    equity,
    totalTrades: closedCount + openCount,
    closedTrades: closedCount,
    openTrades: openCount,
    winningTrades: wins,
    losingTrades: losses,
    winRate,
    profitFactor,
    avgWin: wins > 0 ? grossProfit / wins : 0,
    avgLoss: losses > 0 ? grossLoss / losses : 0,
    largestWin,
    largestLoss,
    totalVolume,
    grossProfit,
    grossLoss,
    tradingDays: days.size,
  };
}

/**
 * Equity curve bucketed by calendar day (one point per day with activity),
 * so the chart payload is bounded by the account's age rather than its trade
 * count.
 */
export function buildEquityCurve(
  startingBalance: number,
  trades: TradeLike[],
): { date: string; balance: number; equity: number }[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    if (t.archivedAt || t.status !== "CLOSED" || !t.closeTime) continue;
    const key = t.closeTime.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + t.netProfit);
  }
  const days = Array.from(byDay.keys()).sort();

  let running = startingBalance;
  const points: { date: string; balance: number; equity: number }[] = [
    { date: days[0] ?? "start", balance: running, equity: running },
  ];
  for (const day of days) {
    running = roundCurrency(running + (byDay.get(day) ?? 0));
    points.push({ date: day, balance: running, equity: running });
  }
  return points;
}

export function currentDrawdownPercent(highWaterMark: number, equity: number): number {
  if (highWaterMark <= 0) return 0;
  return Math.max(0, ((highWaterMark - equity) / highWaterMark) * 100);
}

export function dailyDrawdownPercent(dailyAnchorBalance: number, equity: number): number {
  if (dailyAnchorBalance <= 0) return 0;
  return Math.max(0, ((dailyAnchorBalance - equity) / dailyAnchorBalance) * 100);
}

/**
 * Rounds a monetary value to the nearest cent, symmetrically for gains and
 * losses (half away from zero), so a half-cent loss is never "forgiven" by
 * Math.round's round-half-up behaviour on negative numbers. All
 * challenge-engine boundary comparisons are done in rounded-cent terms so
 * binary floating-point noise (e.g. 10000 * 0.08 = 799.9999999999999) can
 * never flip an exact-boundary result.
 */
export function roundCurrency(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100)) / 100;
}
