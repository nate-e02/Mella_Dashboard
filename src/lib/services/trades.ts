import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/services/audit";
import { evaluateAccount } from "@/lib/services/challengeEngine";

const DEMO_SYMBOLS = ["EURUSD", "GBPUSD", "XAUUSD", "US30", "NAS100", "BTCUSD"];

/**
 * Admin-triggered demo trade generator. There is no live trading engine in
 * this build, so this is the mechanism used to exercise the challenge status
 * engine (pass/fail/fund transitions) against real persisted trade records.
 */
export async function simulateTrades(accountId: string, count: number, winBias: number, actorId: string) {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  let openTime = new Date(Date.now() - count * 20 * 60 * 60 * 1000);

  for (let i = 0; i < count; i++) {
    const isWin = Math.random() < winBias;
    const pct = (isWin ? 1 : -1) * (0.2 + Math.random() * 1.2);
    const netProfit = Number(((account.startingBalance * pct) / 100).toFixed(2));
    const closeTime = new Date(openTime.getTime() + (30 + Math.random() * 240) * 60 * 1000);

    await prisma.trade.create({
      data: {
        accountId,
        symbol: DEMO_SYMBOLS[Math.floor(Math.random() * DEMO_SYMBOLS.length)],
        side: Math.random() > 0.5 ? "BUY" : "SELL",
        volume: Number((0.1 + Math.random() * 2).toFixed(2)),
        entryPrice: Number((1 + Math.random() * 100).toFixed(4)),
        exitPrice: Number((1 + Math.random() * 100).toFixed(4)),
        openTime,
        closeTime,
        profit: netProfit,
        netProfit,
        status: "CLOSED",
      },
    });
    openTime = new Date(openTime.getTime() + (12 + Math.random() * 24) * 60 * 60 * 1000);
  }

  const updated = await evaluateAccount(accountId, actorId);
  await logAudit({
    actorId,
    action: "DEMO_TRADES_SIMULATED",
    targetType: "TradingAccount",
    targetId: accountId,
    after: { count, winBias, resultingStatus: updated.status },
  });
  return updated;
}

export type TimeframeKey =
  | "this_month"
  | "last_month"
  | "3_months"
  | "6_months"
  | "this_year"
  | "all_time"
  | "custom";

export function resolveTimeframe(
  key: TimeframeKey,
  customFrom?: string,
  customTo?: string,
): { from: Date | undefined; to: Date | undefined } {
  const now = new Date();
  switch (key) {
    case "this_month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: undefined };
    case "last_month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to };
    }
    case "3_months":
      return { from: new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()), to: undefined };
    case "6_months":
      return { from: new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()), to: undefined };
    case "this_year":
      return { from: new Date(now.getFullYear(), 0, 1), to: undefined };
    case "custom":
      return {
        from: customFrom ? new Date(customFrom) : undefined,
        to: customTo ? new Date(customTo) : undefined,
      };
    case "all_time":
    default:
      return { from: undefined, to: undefined };
  }
}

export async function listTradesForAccount(params: {
  accountId: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.TradeWhereInput = { accountId: params.accountId };
  if (params.from || params.to) {
    where.openTime = {};
    if (params.from) where.openTime.gte = params.from;
    if (params.to) where.openTime.lt = params.to;
  }

  const [items, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: { openTime: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.trade.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
