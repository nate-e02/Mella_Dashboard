import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createTemplate, listTemplates } from "@/lib/services/templates";
import { templateSchema } from "@/lib/validation/schemas";
import type { TemplateStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? "";
    const status = (searchParams.get("status") as TemplateStatus | "ALL") ?? "ALL";
    const phase = searchParams.get("phase") ?? "ALL";

    const items = await listTemplates({ search, status, phase });
    return NextResponse.json({ items, total: items.length, page: 1, pageSize: items.length || 1, totalPages: 1 });
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const data = templateSchema.parse(body);
    const template = await createTemplate(data, admin.id);
    return NextResponse.json(template, { status: 201 });
  });
}
