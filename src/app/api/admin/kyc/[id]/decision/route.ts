import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { decideKyc } from "@/lib/services/kyc";
import { kycDecisionSchema } from "@/lib/validation/schemas";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const data = kycDecisionSchema.parse(body);
    const updated = await decideKyc(id, data.status, data.notes, admin.id);
    return NextResponse.json(updated);
  });
}
