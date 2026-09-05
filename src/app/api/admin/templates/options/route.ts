import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const templates = await prisma.template.findMany({
      select: { id: true, name: true, phase: true, groupKey: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(templates);
  });
}
