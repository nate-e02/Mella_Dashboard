import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createTemplate, listTemplates } from "@/lib/services/templates";
import { enumParam, paginationSchema, templateSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse({ ...Object.fromEntries(searchParams), pageSize: searchParams.get("pageSize") ?? "100" });
    const status = enumParam(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"], searchParams.get("status"));
    const phase = enumParam(["PHASE_1", "PHASE_2", "FUNDED"], searchParams.get("phase"));
    return NextResponse.json(await listTemplates({ search, status, phase, page, pageSize }));
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const data = templateSchema.parse(await req.json());
    const template = await createTemplate(data, admin.id);
    return NextResponse.json(template, { status: 201 });
  });
}
