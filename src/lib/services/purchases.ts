import "server-only";
import { prisma } from "@/lib/prisma";
import { toTemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";
import { randomBytes } from "crypto";

function generateDemoTransactionId() {
  return `DEMO-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Executes a DEMO purchase: no real payment gateway is contacted. The
 * template configuration is snapshotted, a Purchase record is created with
 * status PAID, and a matching TradingAccount is created and activated.
 */
export async function createDemoPurchase(userId: string, templateId: string, amount: number) {
  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("Template not found");
  if (template.status !== "ACTIVE") throw new Error("This challenge is no longer available for purchase");
  if (template.phase !== "PHASE_1") throw new Error("Only Phase 1 challenges can be purchased directly");

  const snapshot = toTemplateSnapshot(template);

  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        userId,
        templateId: template.id,
        status: "PAID",
        amount,
        currency: template.currency,
        demoTransactionId: generateDemoTransactionId(),
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

    return { purchase, account };
  });

  await logAudit({
    actorId: userId,
    action: "DEMO_PURCHASE_COMPLETED",
    targetType: "Purchase",
    targetId: result.purchase.id,
    after: { templateId: template.id, amount, accountId: result.account.id },
  });

  return result;
}

export async function listPurchasesForUser(userId: string) {
  return prisma.purchase.findMany({
    where: { userId },
    include: { template: true, tradingAccount: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function refundPurchase(purchaseId: string, actorId: string) {
  const before = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  const updated = await prisma.purchase.update({
    where: { id: purchaseId },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  await logAudit({
    actorId,
    action: "PURCHASE_REFUNDED",
    targetType: "Purchase",
    targetId: purchaseId,
    before: { status: before.status },
    after: { status: updated.status },
  });
  return updated;
}

export async function cancelPurchase(purchaseId: string, actorId: string) {
  const before = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
  const updated = await prisma.purchase.update({
    where: { id: purchaseId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  await logAudit({
    actorId,
    action: "PURCHASE_CANCELLED",
    targetType: "Purchase",
    targetId: purchaseId,
    before: { status: before.status },
    after: { status: updated.status },
  });
  return updated;
}
