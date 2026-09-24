import "server-only";
import { Prisma, type AccountStatus, type TradingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aggregateTrades, dailyNetProfits, sumOpenPositionFloating } from "@/lib/services/accountMetrics";
import { consistencyCheck, determineChallengeTransition, isLegalManualTransition, type FailureReason } from "@/lib/services/challengeRules";
import { roundCurrency } from "@/lib/services/calculations";
import { currentDayStart, needsDailyReset, parseResetTime } from "@/lib/services/dailyReset";
import type { TemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";
import { notifyUser } from "@/lib/services/notifications";
import { ConflictError } from "@/lib/auth/guards";
import { issueCertificate } from "@/lib/services/certificates";

/** True if `err` is a Prisma unique-constraint violation on the given field. */
function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/** Column values every new challenge account starts with, derived from its frozen rules. */
export function newAccountColumns(snapshot: TemplateSnapshot, now = new Date()) {
  return {
    startingBalance: snapshot.startingBalance,
    balance: snapshot.startingBalance,
    equity: snapshot.startingBalance,
    highWaterMark: snapshot.startingBalance,
    dailyAnchorBalance: snapshot.startingBalance,
    dailyAnchorDate: currentDayStart(parseResetTime(snapshot.dailyLossResetTime), now),
    expiresAt: snapshot.durationDays && snapshot.durationDays > 0 ? new Date(now.getTime() + snapshot.durationDays * 86_400_000) : null,
    realizedPnl: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    grossProfit: 0,
    grossLoss: 0,
    marginUsed: 0,
  };
}

/**
 * Legacy accounts (seeded / simulated before the incremental columns existed)
 * have trades but zero counters. Backfill the counters once from SQL so the
 * engine can rely on them from then on.
 */
async function ensureAggregatesBackfilled(account: TradingAccount, resetTimeText: string | undefined): Promise<TradingAccount> {
  if (account.tradeCount > 0) return account;
  const agg = await aggregateTrades(account.id, parseResetTime(resetTimeText));
  if (agg.closed === 0) return account;
  return prisma.tradingAccount.update({
    where: { id: account.id },
    data: {
      realizedPnl: roundCurrency(agg.realized),
      balance: roundCurrency(account.startingBalance + agg.realized),
      tradeCount: agg.closed,
      winCount: agg.wins,
      lossCount: agg.losses,
      grossProfit: roundCurrency(agg.grossProfit),
      grossLoss: roundCurrency(agg.grossLoss),
    },
  });
}

/**
 * Applies the centralized pass/fail/fund state machine to an account.
 *
 * Balance comes from the incrementally maintained `balance`/`realizedPnl`
 * columns (updated in the same transaction as every trade close), equity adds
 * the engine's last persisted floating P&L of open positions plus any legacy
 * OPEN trade rows. The daily-loss anchor is re-captured at the account's own
 * reset boundary (EAT by default), never lazily on a later page view.
 *
 * Concurrency: a real transition is claimed atomically via a conditional
 * `updateMany` (`WHERE status = <status we read>`) inside a transaction with
 * the audit write and next-phase creation, so concurrent evaluations of the
 * same account can never double-transition or double-advance it.
 */
export async function evaluateAccount(accountId: string, actorId?: string, opts: { now?: Date } = {}): Promise<TradingAccount> {
  const now = opts.now ?? new Date();
  let account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const resetTime = parseResetTime(snapshot.dailyLossResetTime);

  account = await ensureAggregatesBackfilled(account, snapshot.dailyLossResetTime);

  const [legacyOpen, positionFloating] = await Promise.all([
    prisma.trade.aggregate({ where: { accountId, status: "OPEN", archivedAt: null }, _sum: { profit: true } }),
    sumOpenPositionFloating(accountId),
  ]);

  const balance = roundCurrency(account.balance);
  const equity = roundCurrency(balance + (legacyOpen._sum.profit ?? 0) + positionFloating);

  let { highWaterMark, dailyAnchorBalance, dailyAnchorDate } = account;
  if (equity > highWaterMark) highWaterMark = equity;

  if (needsDailyReset(dailyAnchorDate, resetTime, now)) {
    // A new trading day began since the anchor was captured. Reconstruct the
    // equity AT the boundary rather than using the current (possibly
    // post-loss) equity, so a loss made earlier today still counts against
    // today's limit even if nothing evaluated the account at the boundary.
    const boundary = currentDayStart(resetTime, now);
    dailyAnchorBalance = await reconstructBoundaryEquity(accountId, balance, boundary);
    dailyAnchorDate = boundary;
  }

  const needsTradingDays = snapshot.profitTarget != null && account.phase !== "FUNDED" && account.status === "ACTIVE";
  const tradingDays = needsTradingDays ? (await aggregateTrades(accountId, resetTime)).tradingDays : 0;

  const expiresAt = account.expiresAt ?? (snapshot.durationDays ? new Date(account.createdAt.getTime() + snapshot.durationDays * 86_400_000) : null);
  const expired = expiresAt != null && expiresAt.getTime() < now.getTime();

  // Consistency only matters (and is only queried) once the target is reached.
  const targetAmount = snapshot.profitTarget != null && snapshot.profitTarget > 0 ? roundCurrency(account.startingBalance * (snapshot.profitTarget / 100)) : null;
  const consistency =
    needsTradingDays && snapshot.consistencyRequirement != null && snapshot.consistencyRequirement > 0 && targetAmount != null && roundCurrency(account.realizedPnl) >= targetAmount
      ? consistencyCheck({ dailyNetProfits: await dailyNetProfits(accountId, resetTime), limitPercent: snapshot.consistencyRequirement })
      : null;

  const previousStatus = account.status;
  const decision = determineChallengeTransition({
    status: previousStatus,
    phase: account.phase,
    startingBalance: account.startingBalance,
    netPnl: account.realizedPnl,
    equity,
    highWaterMark,
    dailyAnchorBalance,
    tradingDays,
    expired,
    consistency,
    snapshot: {
      maxDrawdown: snapshot.maxDrawdown,
      dailyDrawdown: snapshot.dailyDrawdown,
      profitTarget: snapshot.profitTarget,
      minTradingDays: snapshot.minTradingDays,
      drawdownMode: snapshot.drawdownMode ?? "STATIC",
    },
  });

  const numericFields = { balance, equity, highWaterMark, dailyAnchorBalance, dailyAnchorDate, expiresAt };

  if (decision.nextStatus === previousStatus) {
    return prisma.tradingAccount.update({ where: { id: accountId }, data: numericFields });
  }

  const status = decision.nextStatus;
  const passedAt = status === "PASSED" ? now : account.passedAt;
  const failedAt = status === "FAILED" ? now : account.failedAt;

  await prisma.$transaction(async (tx) => {
    const claim = await tx.tradingAccount.updateMany({
      where: { id: accountId, status: previousStatus },
      data: { ...numericFields, status, passedAt, failedAt, statusChangedAt: now, failureReason: decision.failureReason ?? null },
    });

    if (claim.count === 0) {
      await tx.tradingAccount.updateMany({ where: { id: accountId }, data: numericFields });
      return;
    }

    await logAudit(
      {
        actorId: actorId ?? null,
        action: "ACCOUNT_STATUS_AUTO_TRANSITION",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: previousStatus, equity: account.equity },
        after: { status, equity, failureReason: decision.failureReason, maxDrawdownFloor: decision.maxDrawdownFloor, dailyLossFloor: decision.dailyLossFloor },
      },
      tx,
    );

    await notifyUser(
      {
        userId: account.userId,
        title: status === "PASSED" ? "Challenge passed" : "Challenge failed",
        message:
          status === "PASSED"
            ? `Congratulations - ${snapshot.name} is complete. Your next phase account is ready.`
            : `${snapshot.name} was closed: ${describeFailure(decision.failureReason)}.`,
        type: status === "PASSED" ? "success" : "danger",
        link: `/accounts/${accountId}`,
      },
      tx,
    );

    if (status === "PASSED") {
      await issueCertificate(tx, { type: "CHALLENGE_PASSED", userId: account.userId, accountId });
      await advanceToNextPhase(tx, { id: accountId, userId: account.userId, snapshot }, now);
    }
  });

  return prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
}

/**
 * Equity at a past reset boundary: the engine's equity snapshot taken just
 * before the boundary when one exists (it includes floating P&L), otherwise
 * the current balance minus everything realised since the boundary.
 */
async function reconstructBoundaryEquity(accountId: string, currentBalance: number, boundary: Date): Promise<number> {
  const snapshot = await prisma.equitySnapshot.findFirst({
    where: { accountId, at: { lte: boundary, gte: new Date(boundary.getTime() - 15 * 60_000) } },
    orderBy: { at: "desc" },
    select: { equity: true },
  });
  if (snapshot) return roundCurrency(snapshot.equity);
  const since = await prisma.trade.aggregate({
    where: { accountId, status: "CLOSED", archivedAt: null, closeTime: { gte: boundary } },
    _sum: { netProfit: true },
  });
  return roundCurrency(currentBalance - (since._sum.netProfit ?? 0));
}

function describeFailure(reason: FailureReason | null): string {
  switch (reason) {
    case "MAX_DRAWDOWN":
      return "maximum drawdown limit breached";
    case "DAILY_LOSS":
      return "daily loss limit breached";
    case "EXPIRED":
      return "the challenge period ended before the profit target was reached";
    default:
      return "rules violation";
  }
}

/**
 * Creates the follow-on TradingAccount (Phase 2, or Funded) once a phase is
 * passed. The next phase's rules come from the chain frozen at purchase time
 * (`snapshot.nextPhaseSnapshot`); only legacy accounts without a frozen chain
 * fall back to the live template, and then only if it is still ACTIVE.
 */
async function advanceToNextPhase(
  tx: Prisma.TransactionClient,
  account: { id: string; userId: string; snapshot: TemplateSnapshot },
  now: Date,
) {
  let nextSnapshot = account.snapshot.nextPhaseSnapshot ?? null;
  let templateId: string | null = nextSnapshot?.id ?? null;

  if (!nextSnapshot) {
    if (!account.snapshot.nextPhaseId) return;
    const nextTemplate = await tx.template.findUnique({ where: { id: account.snapshot.nextPhaseId } });
    if (!nextTemplate || nextTemplate.status !== "ACTIVE") return;
    const { toTemplateSnapshot } = await import("@/types");
    nextSnapshot = toTemplateSnapshot(nextTemplate);
    templateId = nextTemplate.id;
  }

  try {
    const created = await tx.tradingAccount.create({
      data: {
        userId: account.userId,
        templateId,
        previousAccountId: account.id,
        snapshot: nextSnapshot as never,
        phase: nextSnapshot.phase,
        status: nextSnapshot.phase === "FUNDED" ? "FUNDED" : "ACTIVE",
        ...newAccountColumns(nextSnapshot, now),
        fundedAt: nextSnapshot.phase === "FUNDED" ? now : null,
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
    if (created.status === "FUNDED") {
      await issueCertificate(tx, { type: "FUNDED", userId: account.userId, accountId: created.id });
    }
  } catch (err) {
    if (isUniqueConstraintOn(err, "previousAccountId")) return;
    throw err;
  }
}

/**
 * Immediate FAILED transition requested by the live risk engine after it has
 * closed the account's positions on a breach. Idempotent: an account that is
 * no longer ACTIVE/FUNDED is returned unchanged.
 */
export async function failAccountForBreach(
  accountId: string,
  reason: Extract<FailureReason, "MAX_DRAWDOWN" | "DAILY_LOSS">,
  details: { equity: number; floor: number },
): Promise<TradingAccount> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const before = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (before.status !== "ACTIVE" && before.status !== "FUNDED") return before;

    const claim = await tx.tradingAccount.updateMany({
      where: { id: accountId, status: before.status },
      data: { status: "FAILED", failedAt: now, statusChangedAt: now, failureReason: reason, equity: roundCurrency(details.equity) },
    });
    if (claim.count === 0) return tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });

    await logAudit(
      {
        actorId: null,
        action: "ACCOUNT_STATUS_AUTO_TRANSITION",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: before.status },
        after: { status: "FAILED", failureReason: reason, equity: details.equity, floor: details.floor, source: "LIVE_ENGINE" },
      },
      tx,
    );
    const snapshot = before.snapshot as unknown as TemplateSnapshot;
    await notifyUser(
      {
        userId: before.userId,
        title: "Challenge failed",
        message: `${snapshot.name} was closed: ${describeFailure(reason)}. All open positions were closed.`,
        type: "danger",
        link: `/accounts/${accountId}`,
      },
      tx,
    );
    return tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  });
}

/**
 * Admin-driven manual status change, restricted to the legal transition map
 * (PASSED can never be set by hand). Reinstating an account re-anchors its
 * drawdown references to the current equity so it is not failed again on the
 * very next evaluation for the same historical breach.
 */
export async function setAccountStatusManually(accountId: string, status: AccountStatus, actorId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (!isLegalManualTransition(before.status, status, before.phase)) {
      throw new ConflictError(`Cannot change status from ${before.status} to ${status}`);
    }

    const now = new Date();
    const reinstating = status === "ACTIVE" || status === "FUNDED";
    const snapshot = before.snapshot as unknown as TemplateSnapshot;

    const updated = await tx.tradingAccount.update({
      where: { id: accountId },
      data: {
        status,
        statusChangedAt: now,
        failedAt: status === "FAILED" ? now : reinstating ? null : before.failedAt,
        fundedAt: status === "FUNDED" && !before.fundedAt ? now : before.fundedAt,
        failureReason: status === "FAILED" ? (reason ?? "ADMIN") : reinstating ? null : before.failureReason,
        ...(reinstating
          ? {
              highWaterMark: Math.max(before.equity, before.startingBalance),
              dailyAnchorBalance: before.equity,
              dailyAnchorDate: currentDayStart(parseResetTime(snapshot.dailyLossResetTime), now),
            }
          : {}),
      },
    });

    await logAudit(
      {
        actorId,
        action: "ACCOUNT_STATUS_MANUAL_CHANGE",
        targetType: "TradingAccount",
        targetId: accountId,
        before: { status: before.status, highWaterMark: before.highWaterMark, dailyAnchorBalance: before.dailyAnchorBalance },
        after: { status, reason: reason ?? null, highWaterMark: updated.highWaterMark, dailyAnchorBalance: updated.dailyAnchorBalance },
      },
      tx,
    );

    await notifyUser(
      {
        userId: before.userId,
        title: "Account status changed",
        message: `Your account ${snapshot.name} is now ${status}.`,
        type: reinstating ? "success" : "warning",
        link: `/accounts/${accountId}`,
      },
      tx,
    );

    return updated;
  });
}

/**
 * Resets an account back to its starting configuration (admin action).
 * History is archived, never deleted: trades are stamped `archivedAt` and open
 * positions are closed with reason ADMIN so P&L evidence survives the reset.
 * Refused when the account has already spawned a next-phase account.
 */
export async function resetAccount(accountId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId }, include: { nextAccount: { select: { id: true } } } });
    if (before.nextAccount) {
      throw new ConflictError("This account has already progressed to a next phase and cannot be reset");
    }

    const now = new Date();
    const snapshot = before.snapshot as unknown as TemplateSnapshot;
    const [archived, closedPositions] = await Promise.all([
      tx.trade.updateMany({ where: { accountId, archivedAt: null }, data: { archivedAt: now } }),
      tx.position.updateMany({
        where: { accountId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: now, closeReason: "ADMIN", floatingPnl: 0, marginUsed: 0 },
      }),
    ]);

    const updated = await tx.tradingAccount.update({
      where: { id: accountId },
      data: {
        ...newAccountColumns(snapshot, now),
        status: before.phase === "FUNDED" ? "FUNDED" : "ACTIVE",
        statusChangedAt: now,
        passedAt: null,
        failedAt: null,
        failureReason: null,
        fundedAt: before.phase === "FUNDED" ? (before.fundedAt ?? now) : null,
      },
    });

    await logAudit(
      {
        actorId,
        action: "ACCOUNT_RESET",
        targetType: "TradingAccount",
        targetId: accountId,
        before: {
          status: before.status,
          balance: before.balance,
          equity: before.equity,
          highWaterMark: before.highWaterMark,
          dailyAnchorBalance: before.dailyAnchorBalance,
          tradeCount: before.tradeCount,
          archivedTrades: archived.count,
          closedPositions: closedPositions.count,
        },
        after: { status: updated.status, balance: updated.balance },
      },
      tx,
    );

    return updated;
  });
}

/**
 * Scheduled sweep: re-evaluates every ACTIVE/FUNDED account in batches so
 * time rules (expiry), daily anchors and stale equity never depend on a page
 * being opened. Safe to run concurrently with the live engine.
 */
export async function runRiskSweep(opts: { batchSize?: number; now?: Date } = {}): Promise<{ evaluated: number; transitioned: number; errors: number }> {
  const batchSize = opts.batchSize ?? 200;
  let cursor: string | undefined;
  let evaluated = 0;
  let transitioned = 0;
  let errors = 0;

  for (;;) {
    const batch = await prisma.tradingAccount.findMany({
      where: { status: { in: ["ACTIVE", "FUNDED"] } },
      select: { id: true, status: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      try {
        const after = await evaluateAccount(row.id, undefined, { now: opts.now });
        evaluated += 1;
        if (after.status !== row.status) transitioned += 1;
      } catch (err) {
        errors += 1;
        console.error("risk sweep failed for account", row.id, err instanceof Error ? err.message : err);
      }
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }
  return { evaluated, transitioned, errors };
}
