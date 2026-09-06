import "server-only";
import { Prisma, type AccountStatus, type TradingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAccountMetrics } from "@/lib/services/calculations";
import { determineChallengeTransition } from "@/lib/services/challengeRules";
import type { TemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";

/** True if `err` is a Prisma unique-constraint violation on the given field. */
function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/**
 * Recomputes balance/equity/drawdown from the account's trade history and
 * applies the centralized pass/fail/fund state machine. This is the single
 * source of truth for challenge status transitions - no UI or route handler
 * should mutate `status` directly.
 *
 * Concurrency: if the account's status is changing (a real transition, not
 * just a numeric refresh), the transition is claimed atomically via a
 * conditional `updateMany` (`WHERE status = <status we read>`) inside a
 * database transaction together with the audit log write and any next-phase
 * account creation. Postgres's row lock on that UPDATE serializes concurrent
 * evaluations of the same account, so only one caller ever "wins" a given
 * transition - the other simply refreshes the numeric fields and returns the
 * now-current row. This prevents two concurrent evaluations (e.g. two page
 * views, or a double request) from both creating a next-phase account or
 * both writing a duplicate audit log entry for the same transition, without
 * introducing any new locking infrastructure beyond what Prisma/Postgres
 * already provide.
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

  const previousStatus = account.status;
  const decision = determineChallengeTransition({
    status: previousStatus,
    phase: account.phase,
    startingBalance: account.startingBalance,
    netPnl: metrics.netPnl,
    equity: metrics.equity,
    highWaterMark,
    dailyAnchorBalance,
    tradingDays: metrics.tradingDays,
    snapshot: {
      maxDrawdown: snapshot.maxDrawdown,
      dailyDrawdown: snapshot.dailyDrawdown,
      profitTarget: snapshot.profitTarget,
      minTradingDays: snapshot.minTradingDays,
    },
  });

  const numericFields = {
    balance: metrics.balance,
    equity: metrics.equity,
    highWaterMark,
    dailyAnchorBalance,
    dailyAnchorDate,
  };

  if (decision.nextStatus === previousStatus) {
    // No status transition - refreshing these derived fields is always safe
    // to race, since every concurrent evaluator recomputes the same values
    // from the same trade history.
    await prisma.tradingAccount.update({ where: { id: accountId }, data: numericFields });
    return prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  }

  const status = decision.nextStatus;
  const passedAt = status === "PASSED" ? now : account.passedAt;
  const failedAt = status === "FAILED" ? now : account.failedAt;

  await prisma.$transaction(async (tx) => {
    const claim = await tx.tradingAccount.updateMany({
      where: { id: accountId, status: previousStatus },
      data: { ...numericFields, status, passedAt, failedAt, statusChangedAt: now },
    });

    if (claim.count === 0) {
      // Another concurrent evaluation already transitioned this account
      // (and already logged/advanced it) between our read and our write.
      // We lost the race - just make sure the numeric fields are current.
      await tx.tradingAccount.updateMany({ where: { id: accountId }, data: numericFields });
      return;
    }

    await logAudit(
      {
        actorId: actorId ?? null,
        action: "ACCOUNT_STATUS_AUTO_TRANSITION",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: previousStatus },
        after: { status },
      },
      tx,
    );

    if (status === "PASSED") {
      await advanceToNextPhase(tx, { id: accountId, userId: account.userId, snapshot });
    }
  });

  return prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
}

/** Creates the follow-on TradingAccount (Phase 2, or Funded) once a phase is passed. */
async function advanceToNextPhase(
  tx: Prisma.TransactionClient,
  account: { id: string; userId: string; snapshot: TemplateSnapshot },
) {
  if (!account.snapshot.nextPhaseId) {
    return;
  }

  const nextTemplate = await tx.template.findUnique({ where: { id: account.snapshot.nextPhaseId } });
  if (!nextTemplate) return;

  const { toTemplateSnapshot } = await import("@/types");
  const nextSnapshot = toTemplateSnapshot(nextTemplate);

  try {
    const created = await tx.tradingAccount.create({
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

    await logAudit(
      {
        actorId: null,
        action: "ACCOUNT_PHASE_ADVANCED",
        targetType: "TradingAccount",
        targetId: created.id,
        before: { previousAccountId: account.id },
        after: { phase: created.phase, status: created.status },
      },
      tx,
    );
  } catch (err) {
    // previousAccountId is unique - if a concurrent transaction already
    // created the next-phase account for this source account, this is
    // expected and not an error; there is nothing more to do.
    if (isUniqueConstraintOn(err, "previousAccountId")) return;
    throw err;
  }
}

/** Admin-driven manual status override (suspend, freeze, reinstate, etc.). */
export async function setAccountStatusManually(
  accountId: string,
  status: AccountStatus,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

    const updated = await tx.tradingAccount.update({
      where: { id: accountId },
      data: {
        status,
        statusChangedAt: new Date(),
        passedAt: status === "PASSED" ? new Date() : before.passedAt,
        failedAt: status === "FAILED" ? new Date() : before.failedAt,
        fundedAt: status === "FUNDED" ? new Date() : before.fundedAt,
      },
    });

    await logAudit(
      {
        actorId,
        action: "ACCOUNT_STATUS_MANUAL_CHANGE",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: before.status },
        after: { status },
      },
      tx,
    );

    return updated;
  });
}

/** Resets an account back to its starting configuration (admin action). */
export async function resetAccount(accountId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

    await tx.trade.deleteMany({ where: { accountId } });

    const updated = await tx.tradingAccount.update({
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

    await logAudit(
      {
        actorId,
        action: "ACCOUNT_RESET",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: before.status, balance: before.balance },
        after: { status: updated.status, balance: updated.balance },
      },
      tx,
    );

    return updated;
  });
}
