import { NextRequest, NextResponse } from "next/server";
import { assertDevOverridesEnabled, requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { activatePurchase } from "@/lib/services/purchases";

/**
 * Development-only: activates a purchase without a real Chapa payment.
 * Returns 404 unless ENABLE_DEV_OVERRIDES=true outside production. Runs the
 * exact same `activatePurchase` logic a verified payment uses.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    assertDevOverridesEnabled();
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const result = await activatePurchase(id, { source: "ADMIN_TEST", adminId: admin.id });
    return NextResponse.json(result);
  });
}
