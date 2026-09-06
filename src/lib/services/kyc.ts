import "server-only";
import { prisma } from "@/lib/prisma";
import type { KycStatus, Prisma } from "@prisma/client";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/auth/guards";

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
      { id: { contains: params.search, mode: "insensitive" } },
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
  const [total, pending, approved, rejected] = await Promise.all([
    prisma.kycSubmission.count(),
    prisma.kycSubmission.count({ where: { status: "PENDING" } }),
    prisma.kycSubmission.count({ where: { status: "APPROVED" } }),
    prisma.kycSubmission.count({ where: { status: "REJECTED" } }),
  ]);
  return { total, pending, approved, rejected };
}

export async function decideKyc(
  id: string,
  status: "APPROVED" | "REJECTED",
  notes: string | undefined,
  reviewerId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.kycSubmission.findUniqueOrThrow({ where: { id } });
    if (before.status !== "PENDING") {
      throw new ConflictError(`This submission has already been ${before.status.toLowerCase()}`);
    }

    const updated = await tx.kycSubmission.update({
      where: { id },
      data: { status, notes: notes ?? before.notes, reviewedAt: new Date(), reviewerId },
    });

    await logAudit(
      {
        actorId: reviewerId,
        action: status === "APPROVED" ? "KYC_APPROVED" : "KYC_REJECTED",
        targetType: "KycSubmission",
        targetId: id,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );

    return updated;
  });
}

export async function createKycSubmission(data: {
  userId: string;
  fullName: string;
  country: string;
  documentType: string;
}) {
  return prisma.kycSubmission.create({ data });
}
