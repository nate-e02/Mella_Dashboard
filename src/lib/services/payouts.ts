import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/auth/guards";

export async function listPayouts() {
  return prisma.payout.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      tradingAccount: { select: { id: true, template: { select: { name: true } } } },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function createPayout(tradingAccountId: string, amount: number, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.tradingAccount.findUniqueOrThrow({ where: { id: tradingAccountId } });
    const payout = await tx.payout.create({
      data: { tradingAccountId, userId: account.userId, amount, status: "PENDING" },
    });
    await logAudit({ actorId, action: "PAYOUT_CREATED", targetType: "Payout", targetId: payout.id, after: payout }, tx);
    return payout;
  });
}

export async function decidePayout(id: string, status: "PAID" | "REJECTED", actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.payout.findUniqueOrThrow({ where: { id } });
    if (before.status !== "PENDING") {
      throw new ConflictError(`This payout has already been ${before.status.toLowerCase()}`);
    }

    const updated = await tx.payout.update({
      where: { id },
      data: { status, paidAt: status === "PAID" ? new Date() : null },
    });
    await logAudit(
      { actorId, action: `PAYOUT_${status}`, targetType: "Payout", targetId: id, before: { status: before.status }, after: { status } },
      tx,
    );
    return updated;
  });
}
