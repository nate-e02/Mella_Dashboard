import "server-only";
import { prisma } from "@/lib/prisma";

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

export async function getOverviewStats() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const weekAgo = daysAgo(7);

  const [
    revenueToday,
    revenueMonth,
    revenueTotal,
    newSignupsToday,
    fundedAccounts,
    fundedAgg,
    phase1Passed,
    phase1Failed,
    phase2Passed,
    phase2Failed,
    failedThisWeek,
    failedThisMonth,
    payoutsThisMonth,
    allPaidPayouts,
    refundsLast30,
    purchasesLast30,
    payingUsers,
    allPurchases,
  ] = await Promise.all([
    prisma.purchase.aggregate({ where: { status: "PAID", paymentDate: { gte: todayStart } }, _sum: { amount: true } }),
    prisma.purchase.aggregate({ where: { status: "PAID", paymentDate: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.purchase.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.tradingAccount.findMany({ where: { status: "FUNDED" }, select: { startingBalance: true, balance: true } }),
    prisma.tradingAccount.aggregate({ where: { status: "FUNDED" }, _sum: { startingBalance: true } }),
    prisma.tradingAccount.count({ where: { phase: "PHASE_1", status: "PASSED" } }),
    prisma.tradingAccount.count({ where: { phase: "PHASE_1", status: "FAILED" } }),
    prisma.tradingAccount.count({ where: { phase: "PHASE_2", status: "PASSED" } }),
    prisma.tradingAccount.count({ where: { phase: "PHASE_2", status: "FAILED" } }),
    prisma.tradingAccount.count({ where: { status: "FAILED", failedAt: { gte: weekAgo } } }),
    prisma.tradingAccount.count({ where: { status: "FAILED", failedAt: { gte: monthStart } } }),
    prisma.payout.findMany({ where: { status: "PAID", paidAt: { gte: monthStart } }, select: { amount: true } }),
    prisma.payout.findMany({ where: { status: "PAID" }, select: { amount: true } }),
    prisma.purchase.count({ where: { status: "REFUNDED", refundedAt: { gte: daysAgo(30) } } }),
    prisma.purchase.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.purchase.groupBy({ by: ["userId"], where: { status: "PAID" }, _count: { _all: true } }),
    prisma.purchase.count({ where: { status: "PAID" } }),
  ]);

  const totalFundedPnl = fundedAccounts.reduce((s, a) => s + (a.balance - a.startingBalance), 0);
  const largestFundedPnl = fundedAccounts.reduce((max, a) => Math.max(max, a.balance - a.startingBalance), 0);
  const approachingPayout = fundedAccounts.filter(
    (a) => a.startingBalance > 0 && (a.balance - a.startingBalance) / a.startingBalance >= 0.05,
  ).length;

  const repeatBuyers = payingUsers.filter((g) => g._count._all > 1).length;
  const uniquePayingUsers = payingUsers.length;

  const payoutsThisMonthSum = payoutsThisMonth.reduce((s, p) => s + p.amount, 0);
  const avgPayoutSize = allPaidPayouts.length > 0 ? allPaidPayouts.reduce((s, p) => s + p.amount, 0) / allPaidPayouts.length : 0;

  const phase1Total = phase1Passed + phase1Failed;
  const phase2Total = phase2Passed + phase2Failed;

  const revenueTotalAmount = revenueTotal._sum.amount ?? 0;

  return {
    revenueToday: revenueToday._sum.amount ?? 0,
    revenueMonth: revenueMonth._sum.amount ?? 0,
    revenueTotal: revenueTotalAmount,
    newSignupsToday,
    activeFundedAccounts: fundedAccounts.length,
    fundedCapitalDeployed: fundedAgg._sum.startingBalance ?? 0,
    phase1PassRate: phase1Total > 0 ? (phase1Passed / phase1Total) * 100 : 0,
    phase1Passed,
    phase1Total,
    phase2PassRate: phase2Total > 0 ? (phase2Passed / phase2Total) * 100 : 0,
    phase2Passed,
    phase2Total,
    totalFundedPnl,
    largestFundedPnl,
    failedThisWeek,
    failedThisMonth,
    repeatBuyers,
    uniquePayingUsers,
    payoutsThisMonthCount: payoutsThisMonth.length,
    payoutsThisMonthSum,
    avgPayoutSize,
    revenuePerUser: uniquePayingUsers > 0 ? revenueTotalAmount / uniquePayingUsers : 0,
    fundedApproachingPayout: approachingPayout,
    refundRate: purchasesLast30 > 0 ? (refundsLast30 / purchasesLast30) * 100 : 0,
    chargebackRate: 0,
    promoDiscounts: 0,
    totalPaidPurchases: allPurchases,
  };
}

export async function getRevenueSeries(days = 30) {
  const start = daysAgo(days - 1);
  const purchases = await prisma.purchase.findMany({
    where: { status: "PAID", paymentDate: { gte: start } },
    select: { amount: true, paymentDate: true },
  });

  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const p of purchases) {
    if (!p.paymentDate) continue;
    const key = p.paymentDate.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + p.amount);
  }
  return Array.from(byDay.entries()).map(([date, revenue]) => ({ date, revenue }));
}

export async function getSignupSeries(days = 30) {
  const start = daysAgo(days - 1);
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: start } },
    select: { createdAt: true },
  });
  const byDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const u of users) {
    const key = u.createdAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return Array.from(byDay.entries()).map(([date, signups]) => ({ date, signups }));
}
