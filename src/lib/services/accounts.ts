import "server-only";
import { prisma } from "@/lib/prisma";
import type { AccountStatus, Prisma } from "@prisma/client";
import { evaluateAccount, newAccountColumns } from "@/lib/services/challengeEngine";
import { buildPurchaseSnapshot } from "@/lib/services/purchases";
import { logAudit } from "@/lib/services/audit";
import { notifyUser } from "@/lib/services/notifications";
import { notifyWorkerAccountChanged } from "@/lib/services/settings";

const RECENT_TRADES = 50;

export async function listAccounts(params: {
  search?: string;
  status?: AccountStatus | "ALL";
  page: number;
  pageSize: number;
}) {
  const where: Prisma.TradingAccountWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.search) {
    where.OR = [
      { id: params.search },
      { user: { name: { contains: params.search, mode: "insensitive" } } },
      { user: { email: { contains: params.search, mode: "insensitive" } } },
      { template: { name: { contains: params.search, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.tradingAccount.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.tradingAccount.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

/**
 * Read-only account fetch for display: owner/template/purchase plus the most
 * recent trades (bounded). Never mutates anything - see `refreshAccount`.
 */
export async function getAccountDetail(id: string) {
  return prisma.tradingAccount.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      template: { select: { id: true, name: true, phase: true } },
      trades: { where: { archivedAt: null }, orderBy: { openTime: "desc" }, take: RECENT_TRADES },
      purchase: { select: { id: true, status: true, amount: true, currency: true, paymentDate: true } },
      positions: { where: { status: "OPEN" }, orderBy: { openedAt: "desc" } },
    },
  });
}

/** Re-runs the rules engine for an account, then returns the detail view. Callers must have already authorized the account. */
export async function refreshAccount(id: string) {
  const exists = await prisma.tradingAccount.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  await evaluateAccount(id);
  return getAccountDetail(id);
}

/** Admin-initiated account creation: directly assigns a user to a template without a payment. */
export async function createAccountForUser(userId: string, templateId: string, actorId: string) {
  const account = await createAccountForUserTx(userId, templateId, actorId);
  notifyWorkerAccountChanged(account.id);
  return account;
}

async function createAccountForUserTx(userId: string, templateId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.template.findUniqueOrThrow({ where: { id: templateId } });
    const snapshot = await buildPurchaseSnapshot(template, tx);

    const account = await tx.tradingAccount.create({
      data: {
        userId,
        templateId: template.id,
        snapshot: snapshot as never,
        phase: template.phase,
        status: template.phase === "FUNDED" ? "FUNDED" : "ACTIVE",
        ...newAccountColumns(snapshot),
        fundedAt: template.phase === "FUNDED" ? new Date() : null,
      },
    });

    await logAudit(
      { actorId, action: "ACCOUNT_CREATED_BY_ADMIN", targetType: "TradingAccount", targetId: account.id, after: { userId, templateId } },
      tx,
    );
    await notifyUser({ userId, title: "New trading account", message: `${template.name} has been assigned to you.`, type: "success", link: `/accounts/${account.id}` }, tx);

    return account;
  });
}

export async function listAccountsForUser(userId: string, take = 50) {
  return prisma.tradingAccount.findMany({
    where: { userId },
    include: { template: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}
