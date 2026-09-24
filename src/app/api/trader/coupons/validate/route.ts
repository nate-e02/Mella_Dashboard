import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { validateCoupon } from "@/lib/services/coupons";
import { couponValidateSchema } from "@/lib/validation/growth";

/**
 * Quote for the checkout modal. Rate limited per IP in the proxy (20/min) so
 * it cannot be used to enumerate codes; the purchase itself re-validates.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { code, templateId } = couponValidateSchema.parse(await req.json());
    const result = await validateCoupon({ code, templateId, userId: user.id });
    if (!result.ok) {
      return NextResponse.json({ valid: false, reason: result.reason, listPrice: result.listPrice, discount: 0, finalAmount: result.listPrice });
    }
    return NextResponse.json({ valid: true, code: result.coupon.code, listPrice: result.listPrice, discount: result.discount, finalAmount: result.finalAmount });
  });
}
