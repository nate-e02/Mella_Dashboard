import "server-only";
import { prisma } from "@/lib/prisma";
import { clientIpFromHeaders, nullIfUnknown } from "@/lib/auth/rateLimit";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Records an audit log entry. Accepts an optional Prisma client so callers
 * that need the audit write to succeed-or-fail atomically with the mutation
 * it describes can pass their `tx` (interactive transaction client) instead
 * of the global client - see challengeEngine.ts / templates.ts for examples.
 */
export async function logAudit(
  params: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    /** Request correlation (ip / user agent / request id) when available. */
    context?: { ip?: string | null; userAgent?: string | null; requestId?: string | null } | null;
  },
  db: Db = prisma,
) {
  const context = params.context === undefined ? await currentRequestContext() : params.context;
  await db.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      before: (params.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (params.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      requestId: context?.requestId ?? null,
    },
  });
}

/**
 * Best-effort request context. Inside a Next.js request this reads the
 * incoming headers; in the worker (no request scope) it resolves to null.
 */
async function currentRequestContext(): Promise<{ ip: string | null; userAgent: string | null; requestId: string | null } | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      ip: nullIfUnknown(clientIpFromHeaders(h)),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      requestId: h.get("x-request-id"),
    };
  } catch {
    return null;
  }
}

export async function listAuditLogs(params: { page: number; pageSize: number; action?: string; targetType?: string; actorId?: string; search?: string }) {
  const where: Prisma.AuditLogWhereInput = {};
  if (params.action) where.action = params.action;
  if (params.targetType) where.targetType = params.targetType;
  if (params.actorId) where.actorId = params.actorId;
  if (params.search) where.OR = [{ targetId: params.search }, { action: { contains: params.search.toUpperCase() } }];
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
