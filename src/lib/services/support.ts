import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUser } from "@/lib/services/notifications";

export async function createTicket(userId: string, subject: string, message: string) {
  return prisma.supportTicket.create({ data: { userId, subject, message } });
}

export async function listTicketsForUser(userId: string) {
  return prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function listTickets(params: { page: number; pageSize: number; status?: string; search?: string }) {
  const where: Prisma.SupportTicketWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status as Prisma.SupportTicketWhereInput["status"];
  if (params.search) where.OR = [{ subject: { contains: params.search, mode: "insensitive" } }, { user: { email: { contains: params.search, mode: "insensitive" } } }];
  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function updateTicket(id: string, data: { status?: "OPEN" | "PENDING" | "RESOLVED" | "CLOSED"; response?: string; priority?: string }, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.supportTicket.findUniqueOrThrow({ where: { id } });
    const updated = await tx.supportTicket.update({ where: { id }, data });
    await logAudit({ actorId, action: "TICKET_UPDATED", targetType: "SupportTicket", targetId: id, before: { status: before.status }, after: { status: updated.status } }, tx);
    if (data.response && data.response !== before.response) {
      await notifyUser({ userId: before.userId, title: "Support replied", message: `Re: ${before.subject}`, type: "info", link: "/account" }, tx);
    }
    return updated;
  });
}
