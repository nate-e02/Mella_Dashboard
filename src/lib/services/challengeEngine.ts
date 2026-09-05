import "server-only";
import { prisma } from "@/lib/prisma";
import type { AccountStatus, TradingAccount } from "@prisma/client";
import { computeAccountMetrics, currentDrawdownPercent, dailyDrawdownPercent } from "@/lib/services/calculations";
import type { TemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";

const TERMINAL_MANUAL_STATUSES: AccountStatus[] = ["SUSPENDED", "FROZEN"];

/**
 * Recomputes balance/equity/drawdown from the account's trade history and
 * applies the centralized pass/fail/fund state machine. This is the single
 * source of truth for challenge status transitions - no UI or route handler
 * should mutate `status` directly.
 */
export async function evaluateAccount(accountId: string, actorId?: string): Promise<TradingAccount> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: { trades: true },
  });

  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const metrics = computeAccountMetrics(account.startingBalance, account.trades);

  let { highWaterMark, dailyAnchorBalance, dailyAnchorDate } = account;
  if (metrics.equity > highWaterMark) highWaterMark = metrics.equity;

  const now = new Date();
  const isNewDay = dailyAnchorDate.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
  if (isNewDay) {
    dailyAnchorBalance = metrics.balance;
    dailyAnchorDate = now;
  }

  let status = account.status;
  const phase = account.phase;
  const previousStatus = status;
  let passedAt = account.passedAt;
  let failedAt = account.failedAt;
  const fundedAt = account.fundedAt;

  const canAutoEvaluate = !TERMINAL_MANUAL_STATUSES.includes(status) && status !== "FAILED";

  if (canAutoEvaluate) {
    const ddBreach = currentDrawdownPercent(highWaterMark, metrics.equity) >= snapshot.maxDrawdown;
    const dailyBreach = dailyDrawdownPercent(dailyAnchorBalance, metrics.equity) >= snapshot.dailyDrawdown;

    if (ddBreach || dailyBreach) {
      status = "FAILED";
      failedAt = now;
    } else if (phase !== "FUNDED" && status === "ACTIVE") {
      const targetAmount = snapshot.profitTarget
        ? account.startingBalance * (snapshot.profitTarget / 100)
        : null;
      const meetsTarget = targetAmount !== null && metrics.netPnl >= targetAmount;
      const meetsMinDays = metrics.tradingDays >= snapshot.minTradingDays;

      if (meetsTarget && meetsMinDays) {
        status = "PASSED";
        passedAt = now;
      }
    }
  }

  const updated = await prisma.tradingAccount.update({
    where: { id: accountId },
    data: {
      balance: metrics.balance,
      equity: metrics.equity,
      highWaterMark,
      dailyAnchorBalance,
      dailyAnchorDate,
      status,
      phase,
      passedAt,
      failedAt,
      fundedAt,
      statusChangedAt: status !== previousStatus ? now : account.statusChangedAt,
    },
  });

  if (status !== previousStatus) {
    await logAudit({
      actorId: actorId ?? null,
      action: "ACCOUNT_STATUS_AUTO_TRANSITION",
      targetType: "TradingAccount",
      targetId: accountId,
      before: { status: previousStatus },
      after: { status },
    });

    if (status === "PASSED") {
      await advanceToNextPhase(updated);
    }
  }

  return updated;
}

/** Creates the follow-on TradingAccount (Phase 2, or Funded) once a phase is passed. */
async function advanceToNextPhase(account: TradingAccount) {
  const snapshot = account.snapshot as unknown as TemplateSnapshot;

  if (!snapshot.nextPhaseId) {
    return;
  }

  const nextTemplate = await prisma.template.findUnique({ where: { id: snapshot.nextPhaseId } });
  if (!nextTemplate) return;

  const { toTemplateSnapshot } = await import("@/types");
  const nextSnapshot = toTemplateSnapshot(nextTemplate);

  const existing = await prisma.tradingAccount.findUnique({
    where: { previousAccountId: account.id },
  });
  if (existing) return;

  const created = await prisma.tradingAccount.create({
    data: {
      userId: account.userId,
      templateId: nextTemplate.id,
      previousAccountId: account.id,
      snapshot: nextSnapshot as never,
      phase: nextTemplate.phase,
      status: nextTemplate.phase === "FUNDED" ? "FUNDED" : "ACTIVE",
      startingBalance: nextTemplate.startingBalance,
      balance: nextTemplate.startingBalance,
      equity: nextTemplate.startingBalance,
      highWaterMark: nextTemplate.startingBalance,
      dailyAnchorBalance: nextTemplate.startingBalance,
      fundedAt: nextTemplate.phase === "FUNDED" ? new Date() : null,
    },
  });

  await logAudit({
    actorId: null,
    action: "ACCOUNT_PHASE_ADVANCED",
    targetType: "TradingAccount",
    targetId: created.id,
    before: { previousAccountId: account.id },
    after: { phase: created.phase, status: created.status },
  });
}

/** Admin-driven manual status override (suspend, freeze, reinstate, etc.). */
export async function setAccountStatusManually(
  accountId: string,
  status: AccountStatus,
  actorId: string,
) {
  const before = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

  const updated = await prisma.tradingAccount.update({
    where: { id: accountId },
    data: {
      status,
      statusChangedAt: new Date(),
      passedAt: status === "PASSED" ? new Date() : before.passedAt,
      failedAt: status === "FAILED" ? new Date() : before.failedAt,
      fundedAt: status === "FUNDED" ? new Date() : before.fundedAt,
    },
  });

  await logAudit({
    actorId,
    action: "ACCOUNT_STATUS_MANUAL_CHANGE",
    targetType: "TradingAccount",
    targetId: accountId,
    before: { status: before.status },
    after: { status },
  });

  return updated;
}

/** Resets an account back to its starting configuration (admin action). */
export async function resetAccount(accountId: string, actorId: string) {
  const before = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

  await prisma.trade.deleteMany({ where: { accountId } });

  const updated = await prisma.tradingAccount.update({
    where: { id: accountId },
    data: {
      balance: before.startingBalance,
      equity: before.startingBalance,
      highWaterMark: before.startingBalance,
      dailyAnchorBalance: before.startingBalance,
      dailyAnchorDate: new Date(),
      status: "ACTIVE",
      statusChangedAt: new Date(),
      passedAt: null,
      failedAt: null,
      fundedAt: before.phase === "FUNDED" ? new Date() : null,
    },
  });

  await logAudit({
    actorId,
    action: "ACCOUNT_RESET",
    targetType: "TradingAccount",
    targetId: accountId,
    before: { status: before.status, balance: before.balance },
    after: { status: updated.status, balance: updated.balance },
  });

  return updated;
}
