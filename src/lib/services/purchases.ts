import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toTemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/auth/guards";
import { randomBytes } from "crypto";

function generateDemoTransactionId() {
  return `DEMO-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/**
 * Executes a DEMO purchase: no real payment gateway is contacted. The
 * template configuration is snapshotted, a Purchase record is created with
 * status PAID, and a matching TradingAccount is created and activated - all
 * inside one transaction so the two rows (and their audit trail) are created
 * together or not at all.
 *
 * Idempotency: the caller (the Challenges page) generates one `idempotencyKey`
 * per purchase attempt (i.e. once per "Pay" click) and resends the same key
 * on retry. If a Purchase already exists for that key, it - and its account -
 * are returned as-is instead of creating a duplicate; this covers double
 * submission from a slow network retry or a user double-clicking, including
 * two such requests racing each other (handled via the unique constraint on
 * `idempotencyKey` plus a fallback re-read if the insert loses that race).
 */
export async function createDemoPurchase(
  userId: string,
  templateId: string,
  amount: number,
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const existing = await prisma.purchase.findUnique({
      where: { idempotencyKey },
      include: { tradingAccount: true },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictError("This request has already been processed");
      }
      return { purchase: existing, account: existing.tradingAccount };
    }
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("Template not found");
  if (template.status !== "ACTIVE") throw new Error("This challenge is no longer available for purchase");
  if (template.phase !== "PHASE_1") throw new Error("Only Phase 1 challenges can be purchased directly");

  const snapshot = toTemplateSnapshot(template);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          userId,
          templateId: template.id,
          status: "PAID",
          amount,
          currency: template.currency,
          demoTransactionId: generateDemoTransactionId(),
          idempotencyKey: idempotencyKey ?? null,
          paymentDate: new Date(),
          snapshot: snapshot as never,
        },
      });

      const account = await tx.tradingAccount.create({
        data: {
          userId,
          purchaseId: purchase.id,
          templateId: template.id,
          snapshot: snapshot as never,
          phase: template.phase,
          status: "ACTIVE",
          startingBalance: template.startingBalance,
          balance: template.startingBalance,
          equity: template.startingBalance,
          highWaterMark: template.startingBalance,
          dailyAnchorBalance: template.startingBalance,
        },
      });

      await logAudit(
        {
          actorId: userId,
          action: "DEMO_PURCHASE_COMPLETED",
          targetType: "Purchase",
          targetId: purchase.id,
          after: { templateId: template.id, amount, accountId: account.id },
        },
        tx,
      );

      return { purchase, account };
    });

    return result;
  } catch (err) {
    if (idempotencyKey && isUniqueConstraintOn(err, "idempotencyKey")) {
      // Lost a race against another request with the same key - it already
      // committed the purchase we were about to create; return that instead.
      const existing = await prisma.purchase.findUnique({
        where: { idempotencyKey },
        include: { tradingAccount: true },
      });
      if (existing) return { purchase: existing, account: existing.tradingAccount };
    }
    throw err;
  }
}

export async function listPurchasesForUser(userId: string) {
  return prisma.purchase.findMany({
    where: { userId },
    include: { template: true, tradingAccount: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function refundPurchase(purchaseId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (before.status !== "PAID") {
      throw new ConflictError(`Cannot refund a purchase with status ${before.status}`);
    }

    const updated = await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });
    await logAudit(
      {
        actorId,
        action: "PURCHASE_REFUNDED",
        targetType: "Purchase",
        targetId: purchaseId,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}

export async function cancelPurchase(purchaseId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (before.status !== "PAID" && before.status !== "PENDING") {
      throw new ConflictError(`Cannot cancel a purchase with status ${before.status}`);
    }

    const updated = await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await logAudit(
      {
        actorId,
        action: "PURCHASE_CANCELLED",
        targetType: "Purchase",
        targetId: purchaseId,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}
