import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { activatePurchase } from "@/lib/services/purchases";

/**
 * TEMPORARY development/testing action: lets an admin activate a purchase
 * without a real Chapa payment. Admin-only (requireAdmin), and it runs
 * through the exact same `activatePurchase` logic a verified Chapa payment
 * uses - it does not set any field directly and cannot diverge from that
 * behavior. Idempotent: activating an already-PAID purchase again is a
 * no-op (see activatePurchase).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const result = await activatePurchase(id, { source: "ADMIN_TEST", adminId: admin.id });
    return NextResponse.json(result);
  });
}
