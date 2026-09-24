import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { updateCoupon } from "@/lib/services/coupons";
import { couponUpdateSchema } from "@/lib/validation/growth";

/** Edit or deactivate a coupon (coupons are never deleted: purchases reference them). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const patch = couponUpdateSchema.parse(await req.json());
    return NextResponse.json(await updateCoupon(id, patch, admin.id));
  });
}
