import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, Role, UserStatus } from "@prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/services/audit";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { ConflictError } from "@/lib/auth/guards";

/** Fields safe to return from the API - never include passwordHash. */
const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  lastActivityAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers(params: {
  search?: string;
  role?: Role | "ALL";
  status?: UserStatus | "ALL";
  page: number;
  pageSize: number;
}) {
  const where: Prisma.UserWhereInput = {};
  if (params.role && params.role !== "ALL") where.role = params.role;
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { email: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        _count: { select: { tradingAccounts: true, purchases: true } },
        kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 },
        tradingAccounts: { select: { status: true } },
        purchases: { select: { amount: true, status: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const items = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastActivityAt: u.lastActivityAt,
    accountCount: u._count.tradingAccounts,
    activeAccounts: u.tradingAccounts.filter((a) => a.status === "ACTIVE").length,
    fundedAccounts: u.tradingAccounts.filter((a) => a.status === "FUNDED").length,
    totalPurchases: u._count.purchases,
    totalRevenue: u.purchases.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0),
    kycStatus: u.kycSubmissions[0]?.status ?? "NONE",
  }));

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function getUserDetail(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      ...SAFE_USER_SELECT,
      tradingAccounts: { include: { template: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      purchases: { include: { template: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      kycSubmissions: { orderBy: { submittedAt: "desc" } },
      crmLead: true,
    },
  });
}

export async function createUser(
  data: { name: string; email: string; password: string; role: Role },
  actorId: string,
) {
  // Note: this existence check plus the later create is not itself atomic
  // (two concurrent requests for the same email could both pass it), but the
  // `email @unique` constraint on User is the real guarantee - the loser of
  // that race gets a Prisma P2002, which the API route maps to a clean 409
  // instead of the generic message this check produces in the common case.
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new ConflictError("A user with this email already exists");

  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: data.name, email: data.email, passwordHash, role: data.role },
      select: SAFE_USER_SELECT,
    });

    await logAudit(
      {
        actorId,
        action: "USER_CREATED",
        targetType: "User",
        targetId: user.id,
        after: { name: user.name, email: user.email, role: user.role },
      },
      tx,
    );

    return user;
  });
}

export async function updateUser(
  id: string,
  data: Partial<{ name: string; email: string; role: Role; status: UserStatus }>,
  actorId: string,
) {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id } });
    const result = await tx.user.update({ where: { id }, data, select: SAFE_USER_SELECT });

    await logAudit(
      {
        actorId,
        action: "USER_UPDATED",
        targetType: "User",
        targetId: id,
        before: { name: before.name, email: before.email, role: before.role, status: before.status },
        after: { name: result.name, email: result.email, role: result.role, status: result.status },
      },
      tx,
    );

    if (data.status === "DISABLED" && before.status !== "DISABLED") {
      await revokeAllSessionsForUser(id, tx);
    }

    return result;
  });

  return updated;
}
