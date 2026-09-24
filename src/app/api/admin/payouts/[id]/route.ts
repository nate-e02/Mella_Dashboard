import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { decidePayout } from "@/lib/services/payouts";
import { payoutDecisionSchema } from "@/lib/validation/schemas";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const { status, reason, providerRef } = payoutDecisionSchema.parse(await req.json());
    const updated = await decidePayout(id, status, admin.id, { reason, providerRef });
    return NextResponse.json(updated);
  });
}
