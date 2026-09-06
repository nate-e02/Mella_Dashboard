import "server-only";
import { prisma } from "@/lib/prisma";
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
  },
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      before: (params.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (params.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
