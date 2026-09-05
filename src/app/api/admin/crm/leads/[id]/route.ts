import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { updateLead } from "@/lib/services/crm";
import { leadSchema } from "@/lib/validation/schemas";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const data = leadSchema.partial().parse(body);
    const updated = await updateLead(id, data, admin.id);
    return NextResponse.json(updated);
  });
}
