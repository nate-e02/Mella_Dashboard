import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AccountMetrics } from "@/lib/services/calculations";
import { roundCurrency } from "@/lib/services/calculations";
import { consistencyCheck, type ConsistencyResult } from "@/lib/services/challengeRules";
import { parseResetTime, type ResetTime } from "@/lib/services/dailyReset";

type Db = Prisma.TransactionClient | typeof prisma;

type AggRow = {
  closed: bigint;
  open: bigint;
  realized: number;
  unrealizedlegacy: number;
  wins: bigint;
  losses: bigint;
  grossprofit: number;
  grossloss: number;
  largestwin: number;
  largestloss: number;
  totalvolume: number;
  tradingdays: bigint;
};

/**
 * Trade-history aggregates computed in SQL (one indexed query), never by
 * loading the trade rows into Node. Archived trades (admin resets) are
 * excluded. Trading days are counted in the account's daily-reset timezone.
 */
export async function aggregateTrades(accountId: string, resetTime: ResetTime, db: Db = prisma) {
  // Shift close times into the reset-zone "trading day" before bucketing.
  const shiftMinutes = resetTime.offsetMinutes - (resetTime.hour * 60 + resetTime.minute);
  const rows = await db.$queryRaw<AggRow[]>`
    SELECT
      count(*) FILTER (WHERE status = 'CLOSED')                                        AS closed,
      count(*) FILTER (WHERE status = 'OPEN')                                          AS open,
      coalesce(sum("netProfit") FILTER (WHERE status = 'CLOSED'), 0)::float8           AS realized,
      coalesce(sum("profit")    FILTER (WHERE status = 'OPEN'), 0)::float8             AS unrealizedlegacy,
      count(*) FILTER (WHERE status = 'CLOSED' AND "netProfit" > 0)                    AS wins,
      count(*) FILTER (WHERE status = 'CLOSED' AND "netProfit" < 0)                    AS losses,
      coalesce(sum("netProfit") FILTER (WHERE status = 'CLOSED' AND "netProfit" > 0), 0)::float8      AS grossprofit,
      coalesce(abs(sum("netProfit") FILTER (WHERE status = 'CLOSED' AND "netProfit" < 0)), 0)::float8 AS grossloss,
      coalesce(max("netProfit") FILTER (WHERE status = 'CLOSED'), 0)::float8           AS largestwin,
      coalesce(min("netProfit") FILTER (WHERE status = 'CLOSED'), 0)::float8           AS largestloss,
      coalesce(sum("volume"), 0)::float8                                               AS totalvolume,
      count(DISTINCT date(coalesce("closeTime", "openTime") + make_interval(mins => ${shiftMinutes}::int))) FILTER (WHERE status = 'CLOSED') AS tradingdays
    FROM "Trade"
    WHERE "accountId" = ${accountId} AND "archivedAt" IS NULL
  `;
  const r = rows[0];
  return {
    closed: Number(r?.closed ?? 0),
    open: Number(r?.open ?? 0),
    realized: Number(r?.realized ?? 0),
    unrealizedLegacy: Number(r?.unrealizedlegacy ?? 0),
    wins: Number(r?.wins ?? 0),
    losses: Number(r?.losses ?? 0),
    grossProfit: Number(r?.grossprofit ?? 0),
    grossLoss: Number(r?.grossloss ?? 0),
    largestWin: Math.max(0, Number(r?.largestwin ?? 0)),
    largestLoss: Math.min(0, Number(r?.largestloss ?? 0)),
    totalVolume: Number(r?.totalvolume ?? 0),
    tradingDays: Number(r?.tradingdays ?? 0),
  };
}

/** Sum of the engine's last persisted floating P&L over the account's open positions. */
export async function sumOpenPositionFloating(accountId: string, db: Db = prisma): Promise<number> {
  const agg = await db.position.aggregate({ where: { accountId, status: "OPEN" }, _sum: { floatingPnl: true } });
  return agg._sum.floatingPnl ?? 0;
}

/** Full metrics for an account page, from SQL aggregates only. */
export async function computeAccountMetricsFromDb(
  account: { id: string; startingBalance: number; snapshot: unknown },
  db: Db = prisma,
): Promise<AccountMetrics> {
  const resetTime = parseResetTime((account.snapshot as { dailyLossResetTime?: string } | null)?.dailyLossResetTime);
  const [agg, positionFloating] = await Promise.all([aggregateTrades(account.id, resetTime, db), sumOpenPositionFloating(account.id, db)]);

  const realizedPnl = roundCurrency(agg.realized);
  const unrealizedPnl = roundCurrency(agg.unrealizedLegacy + positionFloating);
  const balance = roundCurrency(account.startingBalance + realizedPnl);
  const equity = roundCurrency(balance + unrealizedPnl);
  const winRate = agg.closed > 0 ? (agg.wins / agg.closed) * 100 : 0;
  const profitFactor = agg.grossLoss > 0 ? agg.grossProfit / agg.grossLoss : agg.wins > 0 ? null : 0;

  return {
    netPnl: realizedPnl,
    realizedPnl,
    unrealizedPnl,
    balance,
    equity,
    totalTrades: agg.closed + agg.open,
    closedTrades: agg.closed,
    openTrades: agg.open,
    winningTrades: agg.wins,
    losingTrades: agg.losses,
    winRate,
    profitFactor,
    avgWin: agg.wins > 0 ? agg.grossProfit / agg.wins : 0,
    avgLoss: agg.losses > 0 ? agg.grossLoss / agg.losses : 0,
    largestWin: agg.largestWin,
    largestLoss: agg.largestLoss,
    totalVolume: agg.totalVolume,
    grossProfit: agg.grossProfit,
    grossLoss: agg.grossLoss,
    tradingDays: agg.tradingDays,
  };
}

/** Daily-bucketed equity curve computed in SQL: one point per day with closed trades. */
export async function buildEquityCurveFromDb(accountId: string, startingBalance: number, db: Db = prisma) {
  const rows = await db.$queryRaw<{ day: Date; pnl: number }[]>`
    SELECT date_trunc('day', "closeTime") AS day, sum("netProfit")::float8 AS pnl
    FROM "Trade"
    WHERE "accountId" = ${accountId} AND status = 'CLOSED' AND "archivedAt" IS NULL AND "closeTime" IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
  let running = startingBalance;
  const points = [{ date: rows[0] ? rows[0].day.toISOString().slice(0, 10) : "start", equity: running }];
  for (const r of rows) {
    running = roundCurrency(running + Number(r.pnl));
    points.push({ date: r.day.toISOString().slice(0, 10), equity: running });
  }
  return points;
}

/**
 * Net profit per trading day (the account's daily-reset boundary, same
 * bucketing as `aggregateTrades`), non-archived closed trades only, oldest
 * day first. Input for the consistency rule.
 */
export async function dailyNetProfits(accountId: string, resetTime: ResetTime, db: Db = prisma): Promise<number[]> {
  const shiftMinutes = resetTime.offsetMinutes - (resetTime.hour * 60 + resetTime.minute);
  const rows = await db.$queryRaw<{ day: Date; net: number }[]>`
    SELECT date(coalesce("closeTime", "openTime") + make_interval(mins => ${shiftMinutes}::int)) AS day, sum("netProfit")::float8 AS net
    FROM "Trade"
    WHERE "accountId" = ${accountId} AND status = 'CLOSED' AND "archivedAt" IS NULL
    GROUP BY 1 ORDER BY 1
  `;
  return rows.map((r) => roundCurrency(Number(r.net)));
}

/** Consistency-rule evaluation for an account (disabled result when its template has no requirement). */
export async function computeConsistency(
  account: { id: string; snapshot: unknown },
  db: Db = prisma,
): Promise<ConsistencyResult> {
  const snap = (account.snapshot as { consistencyRequirement?: number | null; dailyLossResetTime?: string } | null) ?? {};
  const limitPercent = snap.consistencyRequirement ?? null;
  if (limitPercent == null || !(limitPercent > 0)) return consistencyCheck({ dailyNetProfits: [], limitPercent: null });
  const days = await dailyNetProfits(account.id, parseResetTime(snap.dailyLossResetTime), db);
  return consistencyCheck({ dailyNetProfits: days, limitPercent });
}

/** Count of distinct trading days in the account's reset zone. */
export async function countTradingDays(accountId: string, resetTime: ResetTime, db: Db = prisma): Promise<number> {
  const agg = await aggregateTrades(accountId, resetTime, db);
  return agg.tradingDays;
}
