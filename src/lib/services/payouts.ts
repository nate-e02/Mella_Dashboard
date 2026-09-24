import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { ConflictError, AuthError } from "@/lib/auth/guards";
import { evaluateAccount } from "@/lib/services/challengeEngine";
import { computeConsistency } from "@/lib/services/accountMetrics";
import { roundCurrency } from "@/lib/services/calculations";
import { notifyUser, alertOps } from "@/lib/services/notifications";
import type { TemplateSnapshot } from "@/types";
import { notifyWorkerAccountChanged } from "@/lib/services/settings";
import { issueCertificate } from "@/lib/services/certificates";

/** Payouts smaller than this are refused (avoids transfer fees eating the amount). */
export const MIN_PAYOUT_ETB = 500;
/** Days a funded account must be trading before its first payout can be requested. */
export const MIN_FUNDED_DAYS_BEFORE_PAYOUT = 14;

type PayoutDestination = { type: "TELEBIRR" | "CBE_BIRR" | "BANK"; accountNumber: string; accountName: string; bankCode?: string };

export async function listPayouts(params: { page: number; pageSize: number; status?: string }) {
  const where: Prisma.PayoutWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status as Prisma.PayoutWhereInput["status"];
  const [items, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        tradingAccount: { select: { id: true, template: { select: { name: true } } } },
      },
      orderBy: { requestedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.payout.count({ where }),
  ]);
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function listPayoutsForUser(userId: string) {
  return prisma.payout.findMany({
    where: { userId },
    include: { tradingAccount: { select: { id: true, template: { select: { name: true } } } } },
    orderBy: { requestedAt: "desc" },
    take: 50,
  });
}

/**
 * How much of an account's profit can still be paid out.
 *
 * Paid payouts are already reflected in the balance (paying X to the trader
 * consumes X / split of profit: X to the trader, the rest is the firm's
 * share). So: available = (balance − starting balance) × split − payouts
 * still PENDING/APPROVED.
 */
export async function computePayoutAvailability(accountId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const account = await db.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const committed = await db.payout.aggregate({
    where: { tradingAccountId: accountId, status: { in: ["PENDING", "APPROVED"] } },
    _sum: { amount: true },
  });
  const profit = roundCurrency(account.balance - account.startingBalance);
  const split = (snapshot.profitSplit ?? 80) / 100;
  const traderShare = roundCurrency(Math.max(0, profit) * split);
  const alreadyCommitted = roundCurrency(committed._sum.amount ?? 0);
  const available = roundCurrency(Math.max(0, traderShare - alreadyCommitted));
  const kyc = await db.kycSubmission.findFirst({ where: { userId: account.userId, status: "APPROVED" }, select: { id: true } });
  const fundedDays = account.fundedAt ? Math.floor((Date.now() - account.fundedAt.getTime()) / 86_400_000) : 0;
  // Consistency rule (when the funded template has one), over this funded account's own closed trades.
  const consistency = await computeConsistency(account, db);
  return {
    account,
    profit,
    profitSplitPercent: snapshot.profitSplit ?? 80,
    traderShare,
    alreadyCommitted,
    available,
    kycApproved: !!kyc,
    fundedDays,
    consistency,
    eligible: account.status === "FUNDED" && !!kyc && fundedDays >= MIN_FUNDED_DAYS_BEFORE_PAYOUT && available >= MIN_PAYOUT_ETB && consistency.ok,
  };
}

/**
 * Creates a payout request. Enforced inside one transaction: the account is
 * FUNDED (after a fresh rules evaluation), the trader's KYC is APPROVED, the
 * account has been funded long enough, and the amount does not exceed the
 * trader's remaining profit share.
 */
export async function createPayout(input: {
  tradingAccountId: string;
  amount: number;
  requestedByUserId: string;
  destination?: PayoutDestination;
  note?: string;
  /** true when an admin records it on the trader's behalf */
  byAdmin?: boolean;
}) {
  const amount = roundCurrency(input.amount);
  if (amount < MIN_PAYOUT_ETB) throw new ConflictError(`Minimum payout is ETB ${MIN_PAYOUT_ETB}`);

  await evaluateAccount(input.tradingAccountId);

  return prisma.$transaction(async (tx) => {
    const availability = await computePayoutAvailability(input.tradingAccountId, tx);
    const { account } = availability;

    if (!input.byAdmin && account.userId !== input.requestedByUserId) throw new AuthError("The requested resource was not found", 404);
    if (account.status !== "FUNDED") throw new ConflictError("Payouts are only available on funded accounts");
    if (!availability.kycApproved) throw new ConflictError("Identity verification (KYC) must be approved before a payout");
    if (availability.fundedDays < MIN_FUNDED_DAYS_BEFORE_PAYOUT) {
      throw new ConflictError(`First payout is available ${MIN_FUNDED_DAYS_BEFORE_PAYOUT} days after funding`);
    }
    if (!availability.consistency.ok) {
      const c = availability.consistency;
      throw new ConflictError(
        c.ratioPercent == null
          ? `Consistency rule: this account has no net profit yet (your best trading day may be at most ${c.limitPercent}% of total profit)`
          : `Consistency rule not met: your best trading day is ${c.ratioPercent.toFixed(1)}% of total profit (limit ${c.limitPercent}%). Keep trading to spread your profit over more days.`,
      );
    }
    if (amount > availability.available) {
      throw new ConflictError(`Amount exceeds available profit share (ETB ${availability.available.toFixed(2)})`);
    }

    const payout = await tx.payout.create({
      data: {
        tradingAccountId: account.id,
        userId: account.userId,
        amount,
        currency: "ETB",
        status: "PENDING",
        createdById: input.requestedByUserId,
        destination: (input.destination ?? undefined) as Prisma.InputJsonValue | undefined,
        note: input.note ?? null,
      },
    });

    await logAudit(
      {
        actorId: input.requestedByUserId,
        action: "PAYOUT_REQUESTED",
        targetType: "Payout",
        targetId: payout.id,
        after: { accountId: account.id, amount, available: availability.available, profit: availability.profit, byAdmin: !!input.byAdmin },
      },
      tx,
    );
    await notifyUser(
      { userId: account.userId, title: "Payout requested", message: `Your payout request of ETB ${amount.toFixed(2)} is pending review.`, type: "info", link: "/account" },
      tx,
    );
    return payout;
  });
}

/**
 * Maker-checker state machine:
 *   PENDING  --APPROVED-->  (approver ≠ requester)
 *   APPROVED --PAID------>  (payer ≠ approver, records the transfer reference; debits the account balance via the ledger)
 *   PENDING|APPROVED --REJECTED-->
 * Each transition is claimed with a compare-and-swap so two admins clicking at
 * once cannot double-apply it.
 */
export async function decidePayout(id: string, status: "APPROVED" | "PAID" | "REJECTED", actorId: string, opts: { reason?: string; providerRef?: string } = {}) {
  const result = await decidePayoutTx(id, status, actorId, opts);
  if (status === "PAID") notifyWorkerAccountChanged(result.tradingAccountId);
  return result;
}

async function decidePayoutTx(id: string, status: "APPROVED" | "PAID" | "REJECTED", actorId: string, opts: { reason?: string; providerRef?: string }) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.payout.findUniqueOrThrow({ where: { id }, include: { tradingAccount: { select: { id: true, userId: true, balance: true } } } });
    const now = new Date();

    let from: ("PENDING" | "APPROVED")[];
    let data: Prisma.PayoutUpdateManyMutationInput;
    switch (status) {
      case "APPROVED":
        if (before.createdById === actorId) throw new AuthError("The admin who created a payout cannot approve it", 403);
        from = ["PENDING"];
        data = { status: "APPROVED", approvedById: actorId, approvedAt: now };
        break;
      case "PAID":
        if (before.status !== "APPROVED") throw new ConflictError("A payout must be approved before it is marked paid");
        if (before.approvedById === actorId) throw new AuthError("The admin who approved a payout cannot mark it paid", 403);
        if (before.createdById === actorId) throw new AuthError("The admin who created a payout cannot mark it paid", 403);
        from = ["APPROVED"];
        data = { status: "PAID", paidById: actorId, paidAt: now, providerRef: opts.providerRef ?? null };
        break;
      case "REJECTED":
        from = ["PENDING", "APPROVED"];
        data = { status: "REJECTED", rejectedById: actorId, rejectedAt: now, rejectReason: opts.reason ?? null };
        break;
    }

    if (!from.includes(before.status as "PENDING" | "APPROVED")) {
      throw new ConflictError(`This payout is already ${before.status.toLowerCase()}`);
    }

    const claim = await tx.payout.updateMany({ where: { id, status: { in: from } }, data });
    if (claim.count === 0) throw new ConflictError("This payout was updated by someone else; refresh and try again");

    if (status === "PAID") {
      // Paying out consumes profit so it can never be paid twice: the trader's
      // amount is `split` of the profit consumed; the remainder is the firm's
      // share. Both legs are recorded in the ledger.
      const account = await tx.tradingAccount.findUniqueOrThrow({ where: { id: before.tradingAccountId }, select: { snapshot: true, balance: true } });
      const split = ((account.snapshot as unknown as TemplateSnapshot).profitSplit ?? 80) / 100;
      const consumed = roundCurrency(split > 0 ? before.amount / split : before.amount);
      const firmShare = roundCurrency(consumed - before.amount);
      // A payout is not a trading loss: shift every drawdown reference down by
      // the same amount so neither the daily-loss nor the max-loss rule treats
      // the withdrawal as a losing move.
      await tx.tradingAccount.update({
        where: { id: before.tradingAccountId },
        data: {
          balance: roundCurrency(account.balance - consumed),
          equity: { decrement: consumed },
          realizedPnl: { decrement: consumed },
          highWaterMark: { decrement: consumed },
          dailyAnchorBalance: { decrement: consumed },
        },
      });
      await tx.ledgerEntry.createMany({
        data: [
          { userId: before.userId, accountId: before.tradingAccountId, type: "PAYOUT", amount: -before.amount, currency: before.currency, refType: "Payout", refId: before.id, note: opts.providerRef ?? null },
          ...(firmShare > 0
            ? [{ userId: before.userId, accountId: before.tradingAccountId, type: "ADJUSTMENT" as const, amount: -firmShare, currency: before.currency, refType: "PayoutFirmShare", refId: before.id, note: `firm profit share ${Math.round((1 - split) * 100)}%` }]
            : []),
        ],
        skipDuplicates: true,
      });
      await issueCertificate(tx, { type: "PAYOUT", userId: before.userId, accountId: before.tradingAccountId, payoutId: before.id, amount: before.amount });
    }

    await logAudit(
      {
        actorId,
        action: `PAYOUT_${status}`,
        targetType: "Payout",
        targetId: id,
        before: { status: before.status, amount: before.amount, accountId: before.tradingAccountId },
        after: { status, reason: opts.reason ?? null, providerRef: opts.providerRef ?? null },
      },
      tx,
    );

    await notifyUser(
      {
        userId: before.userId,
        title: status === "PAID" ? "Payout sent" : status === "APPROVED" ? "Payout approved" : "Payout rejected",
        message:
          status === "PAID"
            ? `ETB ${before.amount.toFixed(2)} has been sent to your payout destination.`
            : status === "APPROVED"
              ? `Your payout of ETB ${before.amount.toFixed(2)} was approved and will be transferred shortly.`
              : `Your payout request was rejected${opts.reason ? `: ${opts.reason}` : ""}.`,
        type: status === "REJECTED" ? "warning" : "success",
        link: "/account",
      },
      tx,
    );
    if (status === "PAID") void alertOps(`Payout PAID: ETB ${before.amount.toFixed(2)} (payout ${id})`);

    return tx.payout.findUniqueOrThrow({ where: { id } });
  });
}

/** Funded accounts with their current payout availability, for the admin "record payout" picker. */
export async function listFundedAccountsForPayout(params: { page: number; pageSize: number }) {
  const [accounts, total] = await Promise.all([
    prisma.tradingAccount.findMany({
      where: { status: "FUNDED" },
      select: { id: true, balance: true, startingBalance: true, snapshot: true, fundedAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.tradingAccount.count({ where: { status: "FUNDED" } }),
  ]);
  const items = await Promise.all(
    accounts.map(async (a) => {
      const availability = await computePayoutAvailability(a.id);
      return { id: a.id, balance: a.balance, startingBalance: a.startingBalance, user: a.user, available: availability.available, kycApproved: availability.kycApproved, eligible: availability.eligible };
    }),
  );
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
