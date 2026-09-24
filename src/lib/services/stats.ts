import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

const REPORTING_CURRENCY = "ETB";
const CACHE_TTL_MS = 60_000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

type FundedRow = { count: bigint; capital: number; pnl: number; largest: number; approaching: bigint };
type PayoutRow = { month_count: bigint; month_sum: number; avg_paid: number };
type BuyerRow = { buyers: bigint; repeat_buyers: bigint };

let memo: { at: number; value: Awaited<ReturnType<typeof computeOverviewStats>> } | null = null;

/**
 * Admin overview KPIs. Every figure is a SQL aggregate (no full-table loads
 * into Node) and only ETB rows are summed so mixed currencies can never be
 * added together. Results are memoised for 60 s per process.
 */
async function computeOverviewStats() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const weekAgo = daysAgo(7);
  const thirtyAgo = daysAgo(30);

  const [revenueToday, revenueMonth, revenueTotal, newSignupsToday, phaseCounts, failedThisWeek, failedThisMonth, fundedRows, payoutRows, buyerRows, refundsLast30, purchasesLast30, allPaid] =
    await Promise.all([
      prisma.purchase.aggregate({ where: { status: "PAID", currency: REPORTING_CURRENCY, paymentDate: { gte: todayStart } }, _sum: { amount: true } }),
      prisma.purchase.aggregate({ where: { status: "PAID", currency: REPORTING_CURRENCY, paymentDate: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.purchase.aggregate({ where: { status: "PAID", currency: REPORTING_CURRENCY }, _sum: { amount: true } }),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.tradingAccount.groupBy({ by: ["phase", "status"], where: { status: { in: ["PASSED", "FAILED"] } }, _count: { _all: true } }),
      prisma.tradingAccount.count({ where: { status: "FAILED", failedAt: { gte: weekAgo } } }),
      prisma.tradingAccount.count({ where: { status: "FAILED", failedAt: { gte: monthStart } } }),
      prisma.$queryRaw<FundedRow[]>`
        SELECT count(*) AS count,
               coalesce(sum("startingBalance"), 0)::float8 AS capital,
               coalesce(sum("balance" - "startingBalance"), 0)::float8 AS pnl,
               coalesce(max("balance" - "startingBalance"), 0)::float8 AS largest,
               count(*) FILTER (WHERE "startingBalance" > 0 AND ("balance" - "startingBalance") / "startingBalance" >= 0.05) AS approaching
        FROM "TradingAccount" WHERE status = 'FUNDED'`,
      prisma.$queryRaw<PayoutRow[]>`
        SELECT count(*) FILTER (WHERE "paidAt" >= ${monthStart}) AS month_count,
               coalesce(sum(amount) FILTER (WHERE "paidAt" >= ${monthStart}), 0)::float8 AS month_sum,
               coalesce(avg(amount), 0)::float8 AS avg_paid
        FROM "Payout" WHERE status = 'PAID' AND currency = ${REPORTING_CURRENCY}`,
      prisma.$queryRaw<BuyerRow[]>`
        SELECT count(*) AS buyers, count(*) FILTER (WHERE n > 1) AS repeat_buyers
        FROM (SELECT "userId", count(*) AS n FROM "Purchase" WHERE status = 'PAID' GROUP BY "userId") t`,
      prisma.purchase.count({ where: { status: "REFUNDED", refundedAt: { gte: thirtyAgo } } }),
      prisma.purchase.count({ where: { createdAt: { gte: thirtyAgo } } }),
      prisma.purchase.count({ where: { status: "PAID" } }),
    ]);

  const count = (phase: "PHASE_1" | "PHASE_2", status: "PASSED" | "FAILED") => phaseCounts.find((c) => c.phase === phase && c.status === status)?._count._all ?? 0;
  const phase1Passed = count("PHASE_1", "PASSED");
  const phase1Failed = count("PHASE_1", "FAILED");
  const phase2Passed = count("PHASE_2", "PASSED");
  const phase2Failed = count("PHASE_2", "FAILED");
  const phase1Total = phase1Passed + phase1Failed;
  const phase2Total = phase2Passed + phase2Failed;
  const funded = fundedRows[0];
  const payouts = payoutRows[0];
  const buyers = buyerRows[0];
  const revenueTotalAmount = revenueTotal._sum.amount ?? 0;
  const uniquePayingUsers = Number(buyers?.buyers ?? 0);

  return {
    currency: REPORTING_CURRENCY,
    revenueToday: revenueToday._sum.amount ?? 0,
    revenueMonth: revenueMonth._sum.amount ?? 0,
    revenueTotal: revenueTotalAmount,
    newSignupsToday,
    activeFundedAccounts: Number(funded?.count ?? 0),
    fundedCapitalDeployed: Number(funded?.capital ?? 0),
    phase1PassRate: phase1Total > 0 ? (phase1Passed / phase1Total) * 100 : 0,
    phase1Passed,
    phase1Total,
    phase2PassRate: phase2Total > 0 ? (phase2Passed / phase2Total) * 100 : 0,
    phase2Passed,
    phase2Total,
    totalFundedPnl: Number(funded?.pnl ?? 0),
    largestFundedPnl: Number(funded?.largest ?? 0),
    failedThisWeek,
    failedThisMonth,
    repeatBuyers: Number(buyers?.repeat_buyers ?? 0),
    uniquePayingUsers,
    payoutsThisMonthCount: Number(payouts?.month_count ?? 0),
    payoutsThisMonthSum: Number(payouts?.month_sum ?? 0),
    avgPayoutSize: Number(payouts?.avg_paid ?? 0),
    revenuePerUser: uniquePayingUsers > 0 ? revenueTotalAmount / uniquePayingUsers : 0,
    fundedApproachingPayout: Number(funded?.approaching ?? 0),
    refundRate: purchasesLast30 > 0 ? (refundsLast30 / purchasesLast30) * 100 : 0,
    totalPaidPurchases: allPaid,
  };
}

export const getOverviewStats = cache(async () => {
  if (memo && Date.now() - memo.at < CACHE_TTL_MS) return memo.value;
  const value = await computeOverviewStats();
  memo = { at: Date.now(), value };
  return value;
});

export async function getRevenueSeries(days = 30) {
  const start = daysAgo(days - 1);
  const rows = await prisma.$queryRaw<{ day: Date; revenue: number }[]>`
    SELECT date_trunc('day', "paymentDate") AS day, sum(amount)::float8 AS revenue
    FROM "Purchase" WHERE status = 'PAID' AND currency = ${REPORTING_CURRENCY} AND "paymentDate" >= ${start}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) byDay.set(r.day.toISOString().slice(0, 10), Number(r.revenue));
  return Array.from(byDay.entries()).map(([date, revenue]) => ({ date, revenue }));
}

export async function getSignupSeries(days = 30) {
  const start = daysAgo(days - 1);
  const rows = await prisma.$queryRaw<{ day: Date; signups: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, count(*) AS signups
    FROM "User" WHERE "createdAt" >= ${start}
    GROUP BY 1 ORDER BY 1`;
  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) byDay.set(r.day.toISOString().slice(0, 10), Number(r.signups));
  return Array.from(byDay.entries()).map(([date, signups]) => ({ date, signups }));
}
