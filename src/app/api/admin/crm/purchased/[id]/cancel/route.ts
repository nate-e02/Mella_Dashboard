import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { cancelPurchase } from "@/lib/services/purchases";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const updated = await cancelPurchase(id, admin.id);
    return NextResponse.json(updated);
  });
}
