import "server-only";
import { prisma } from "@/lib/prisma";
import type { AccountStatus, Prisma } from "@prisma/client";
import { evaluateAccount } from "@/lib/services/challengeEngine";

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
      { id: { contains: params.search, mode: "insensitive" } },
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
 * Fetches an account for display, re-running the challenge status engine
 * first so balance/equity/status always reflect the latest trade history -
 * there is no live trading engine to push updates, so reads are the trigger.
 */
export async function getAccountById(id: string) {
  const exists = await prisma.tradingAccount.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  await evaluateAccount(id);

  return prisma.tradingAccount.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      template: true,
      trades: { orderBy: { openTime: "desc" } },
      purchase: true,
    },
  });
}

/** Admin-initiated account creation: directly assigns a user to a template without going through the demo-payment flow. */
export async function createAccountForUser(userId: string, templateId: string, actorId: string) {
  const template = await prisma.template.findUniqueOrThrow({ where: { id: templateId } });
  const { toTemplateSnapshot } = await import("@/types");
  const snapshot = toTemplateSnapshot(template);

  const account = await prisma.tradingAccount.create({
    data: {
      userId,
      templateId: template.id,
      snapshot: snapshot as never,
      phase: template.phase,
      status: template.phase === "FUNDED" ? "FUNDED" : "ACTIVE",
      startingBalance: template.startingBalance,
      balance: template.startingBalance,
      equity: template.startingBalance,
      highWaterMark: template.startingBalance,
      dailyAnchorBalance: template.startingBalance,
      fundedAt: template.phase === "FUNDED" ? new Date() : null,
    },
  });

  const { logAudit } = await import("@/lib/services/audit");
  await logAudit({
    actorId,
    action: "ACCOUNT_CREATED_BY_ADMIN",
    targetType: "TradingAccount",
    targetId: account.id,
    after: { userId, templateId },
  });

  return account;
}

export async function listAccountsForUser(userId: string) {
  return prisma.tradingAccount.findMany({
    where: { userId },
    include: { template: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}
