import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { accountStatusSchema } from "@/lib/validation/schemas";
import { setAccountStatusManually } from "@/lib/services/challengeEngine";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const { status, reason } = accountStatusSchema.parse(await req.json());
    const updated = await setAccountStatusManually(id, status, admin.id, reason);
    return NextResponse.json(updated);
  });
}
