import "server-only";
import { prisma } from "@/lib/prisma";
import type { KycStatus, Prisma } from "@prisma/client";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/auth/guards";
import { notifyUser } from "@/lib/services/notifications";

export async function listKycSubmissions(params: {
  search?: string;
  status?: KycStatus | "ALL";
  page: number;
  pageSize: number;
}) {
  const where: Prisma.KycSubmissionWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.search) {
    where.OR = [
      { id: params.search },
      { fullName: { contains: params.search, mode: "insensitive" } },
      { user: { email: { contains: params.search, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.kycSubmission.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: { submittedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.kycSubmission.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function getKycStats() {
  const grouped = await prisma.kycSubmission.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (s: KycStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return { total: grouped.reduce((n, g) => n + g._count._all, 0), pending: count("PENDING"), approved: count("APPROVED"), rejected: count("REJECTED") };
}

/** True when the user has at least one APPROVED KYC submission. */
export async function hasApprovedKyc(userId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const row = await db.kycSubmission.findFirst({ where: { userId, status: "APPROVED" }, select: { id: true } });
  return !!row;
}

/**
 * Manual admin review decision. Claimed with a compare-and-swap so two
 * reviewers deciding the same submission at once cannot both "win".
 */
export async function decideKyc(id: string, status: "APPROVED" | "REJECTED", notes: string | undefined, reviewerId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.kycSubmission.findUniqueOrThrow({ where: { id } });
    if (before.status !== "PENDING") {
      throw new ConflictError(`This submission has already been ${before.status.toLowerCase()}`);
    }

    const claim = await tx.kycSubmission.updateMany({
      where: { id, status: "PENDING" },
      data: { status, notes: notes ?? before.notes, reviewedAt: new Date(), reviewerId },
    });
    if (claim.count === 0) throw new ConflictError("This submission was decided by another reviewer");

    await logAudit(
      {
        actorId: reviewerId,
        action: status === "APPROVED" ? "KYC_APPROVED" : "KYC_REJECTED",
        targetType: "KycSubmission",
        targetId: id,
        before: { status: before.status },
        after: { status },
      },
      tx,
    );
    await notifyUser(
      {
        userId: before.userId,
        title: status === "APPROVED" ? "Identity verified" : "Verification not approved",
        message: status === "APPROVED" ? "Your identity verification was approved." : "Your identity verification was not approved. You can submit a new verification.",
        type: status === "APPROVED" ? "success" : "warning",
        link: "/account",
      },
      tx,
    );

    return tx.kycSubmission.findUniqueOrThrow({ where: { id } });
  });
}
