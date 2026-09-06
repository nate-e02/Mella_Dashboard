import "server-only";
import { prisma } from "@/lib/prisma";
import type { LeadStatus, Prisma, PurchaseStatus } from "@prisma/client";
import { logAudit } from "@/lib/services/audit";
import type { z } from "zod";
import type { leadSchema } from "@/lib/validation/schemas";

export async function listLeads(params: {
  search?: string;
  status?: LeadStatus | "ALL";
  page: number;
  pageSize: number;
}) {
  const where: Prisma.CrmLeadWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { email: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.crmLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.crmLead.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function getCrmStats() {
  const [totalLeads, qualified, converted, revenue, openTickets, products] = await Promise.all([
    prisma.crmLead.count(),
    prisma.crmLead.count({ where: { status: "QUALIFIED" } }),
    prisma.crmLead.count({ where: { status: "CONVERTED" } }),
    prisma.purchase.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.supportTicket.count({ where: { status: { in: ["OPEN", "PENDING"] } } }),
    prisma.template.count({ where: { status: "ACTIVE" } }),
  ]);
  return {
    totalLeads,
    qualified,
    converted,
    revenue: revenue._sum.amount ?? 0,
    openTickets,
    products,
  };
}

export async function createLead(data: z.infer<typeof leadSchema>, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.crmLead.create({ data });
    await logAudit({ actorId, action: "LEAD_CREATED", targetType: "CrmLead", targetId: lead.id, after: lead }, tx);
    return lead;
  });
}

export async function updateLead(id: string, data: Partial<z.infer<typeof leadSchema>>, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.crmLead.findUniqueOrThrow({ where: { id } });
    const updated = await tx.crmLead.update({ where: { id }, data });
    await logAudit(
      {
        actorId,
        action: "LEAD_UPDATED",
        targetType: "CrmLead",
        targetId: id,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}

export async function listPurchasedRecords(params: {
  search?: string;
  status?: PurchaseStatus | "ALL";
  page: number;
  pageSize: number;
}) {
  const where: Prisma.PurchaseWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.search) {
    where.OR = [
      { user: { name: { contains: params.search, mode: "insensitive" } } },
      { user: { email: { contains: params.search, mode: "insensitive" } } },
      { demoTransactionId: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.purchase.count({ where }),
  ]);

  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}
