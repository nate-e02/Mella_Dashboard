import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { deleteOrArchiveTemplate, getTemplateById, updateTemplate } from "@/lib/services/templates";
import { templateUpdateSchema } from "@/lib/validation/schemas";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const template = await getTemplateById(id);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json(template);
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const data = templateUpdateSchema.parse(body);
    const updated = await updateTemplate(id, data, admin.id);
    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const result = await deleteOrArchiveTemplate(id, admin.id);
    return NextResponse.json(result);
  });
}
