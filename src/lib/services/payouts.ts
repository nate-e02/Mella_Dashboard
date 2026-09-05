import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";

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
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: tradingAccountId } });
  const payout = await prisma.payout.create({
    data: { tradingAccountId, userId: account.userId, amount, status: "PENDING" },
  });
  await logAudit({ actorId, action: "PAYOUT_CREATED", targetType: "Payout", targetId: payout.id, after: payout });
  return payout;
}

export async function decidePayout(id: string, status: "PAID" | "REJECTED", actorId: string) {
  const before = await prisma.payout.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.payout.update({
    where: { id },
    data: { status, paidAt: status === "PAID" ? new Date() : null },
  });
  await logAudit({ actorId, action: `PAYOUT_${status}`, targetType: "Payout", targetId: id, before: { status: before.status }, after: { status } });
  return updated;
}
