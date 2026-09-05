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

/** Pure calculation of account performance metrics from its trade history. */
export function computeAccountMetrics(startingBalance: number, trades: Trade[]): AccountMetrics {
  const closed = trades.filter((t) => t.status === "CLOSED");
  const open = trades.filter((t) => t.status === "OPEN");

  const realizedPnl = closed.reduce((sum, t) => sum + t.netProfit, 0);
  const unrealizedPnl = open.reduce((sum, t) => sum + t.profit, 0);
  const netPnl = realizedPnl;
  const balance = startingBalance + realizedPnl;
  const equity = balance + unrealizedPnl;

  const winners = closed.filter((t) => t.netProfit > 0);
  const losers = closed.filter((t) => t.netProfit < 0);

  const grossProfit = winners.reduce((sum, t) => sum + t.netProfit, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.netProfit, 0));

  const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : winners.length > 0 ? null : 0;

  const avgWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const avgLoss = losers.length > 0 ? grossLoss / losers.length : 0;

  const largestWin = winners.length > 0 ? Math.max(...winners.map((t) => t.netProfit)) : 0;
  const largestLoss = losers.length > 0 ? Math.min(...losers.map((t) => t.netProfit)) : 0;

  const totalVolume = trades.reduce((sum, t) => sum + t.volume, 0);

  const tradingDays = new Set(
    closed.map((t) => (t.closeTime ?? t.openTime).toISOString().slice(0, 10)),
  ).size;

  return {
    netPnl,
    realizedPnl,
    unrealizedPnl,
    balance,
    equity,
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: open.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    totalVolume,
    grossProfit,
    grossLoss,
    tradingDays,
  };
}

export function buildEquityCurve(
  startingBalance: number,
  trades: Trade[],
): { date: string; balance: number; equity: number }[] {
  const closed = [...trades]
    .filter((t) => t.status === "CLOSED" && t.closeTime)
    .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime());

  let running = startingBalance;
  const points: { date: string; balance: number; equity: number }[] = [
    { date: closed[0]?.closeTime?.toISOString().slice(0, 10) ?? "start", balance: running, equity: running },
  ];

  for (const t of closed) {
    running += t.netProfit;
    points.push({
      date: t.closeTime!.toISOString().slice(0, 10),
      balance: running,
      equity: running,
    });
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
