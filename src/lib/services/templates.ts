import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma, TemplateStatus } from "@prisma/client";
import { logAudit } from "@/lib/services/audit";
import type { z } from "zod";
import type { templateSchema, templateUpdateSchema } from "@/lib/validation/schemas";

export async function listTemplates(params: {
  search?: string;
  status?: TemplateStatus | "ALL";
  phase?: string | "ALL";
}) {
  const where: Prisma.TemplateWhereInput = {};
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" } },
      { description: { contains: params.search, mode: "insensitive" } },
      { groupName: { contains: params.search, mode: "insensitive" } },
    ];
  }
  if (params.status && params.status !== "ALL") where.status = params.status;
  if (params.phase && params.phase !== "ALL") where.phase = params.phase as never;

  return prisma.template.findMany({
    where,
    orderBy: [{ groupName: "asc" }, { accountSize: "asc" }, { phase: "asc" }],
    include: { nextPhase: { select: { id: true, name: true } } },
  });
}

export async function getTemplateStats() {
  const [total, active, phase1, phase2, funded, groups] = await Promise.all([
    prisma.template.count(),
    prisma.template.count({ where: { status: "ACTIVE" } }),
    prisma.template.count({ where: { phase: "PHASE_1" } }),
    prisma.template.count({ where: { phase: "PHASE_2" } }),
    prisma.template.count({ where: { phase: "FUNDED" } }),
    prisma.template.findMany({ distinct: ["groupKey"], select: { groupKey: true } }),
  ]);
  return { total, active, programs: groups.length, phase1, phase2, funded };
}

export async function getTemplateById(id: string) {
  return prisma.template.findUnique({
    where: { id },
    include: { nextPhase: { select: { id: true, name: true, phase: true } } },
  });
}

export async function createTemplate(data: z.infer<typeof templateSchema>, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.template.create({ data });
    await logAudit(
      { actorId, action: "TEMPLATE_CREATED", targetType: "Template", targetId: template.id, after: template },
      tx,
    );
    return template;
  });
}

export async function updateTemplate(
  id: string,
  data: z.infer<typeof templateUpdateSchema>,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.template.findUniqueOrThrow({ where: { id } });
    const updated = await tx.template.update({ where: { id }, data });
    await logAudit(
      { actorId, action: "TEMPLATE_UPDATED", targetType: "Template", targetId: id, before, after: updated },
      tx,
    );
    return updated;
  });
}

/**
 * Safe delete: if the template has never been referenced by a purchase, a
 * trading account, or another template's `nextPhaseId` progression link, it
 * is hard-deleted; otherwise it is archived so historical records (and other
 * templates' phase progressions) keep a valid reference. Without the
 * nextPhaseId check, deleting a template that another template still points
 * to as its next phase would fail with an unhandled foreign-key constraint
 * error instead of degrading gracefully to an archive.
 */
export async function deleteOrArchiveTemplate(id: string, actorId: string) {
  const [purchaseCount, accountCount, referencingTemplateCount] = await Promise.all([
    prisma.purchase.count({ where: { templateId: id } }),
    prisma.tradingAccount.count({ where: { templateId: id } }),
    prisma.template.count({ where: { nextPhaseId: id } }),
  ]);

  if (purchaseCount === 0 && accountCount === 0 && referencingTemplateCount === 0) {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.template.delete({ where: { id } });
      await logAudit(
        { actorId, action: "TEMPLATE_DELETED", targetType: "Template", targetId: id, before: deleted },
        tx,
      );
      return { mode: "deleted" as const };
    });
  }

  return prisma.$transaction(async (tx) => {
    const archived = await tx.template.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await logAudit(
      { actorId, action: "TEMPLATE_ARCHIVED", targetType: "Template", targetId: id, after: archived },
      tx,
    );
    return { mode: "archived" as const };
  });
}

/**
 * Templates purchasable on the public storefront / trader Challenges page.
 * Only Phase 1 templates are directly purchasable - Phase 2 and Funded are
 * reached automatically via challenge progression.
 */
export async function listActiveTemplatesForStorefront() {
  return prisma.template.findMany({
    where: { status: "ACTIVE", phase: "PHASE_1" },
    orderBy: [{ groupName: "asc" }, { accountSize: "asc" }],
  });
}
