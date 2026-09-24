import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createPayout, listPayouts } from "@/lib/services/payouts";
import { adminCreatePayoutSchema, enumParam, paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["PENDING", "APPROVED", "PAID", "REJECTED"], searchParams.get("status"));
    return NextResponse.json(await listPayouts({ page, pageSize, status }));
  });
}

/** Admin-recorded payout request on behalf of a trader (still needs a different admin to approve and a third to pay). */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const data = adminCreatePayoutSchema.parse(await req.json());
    const payout = await createPayout({
      tradingAccountId: data.tradingAccountId,
      amount: data.amount,
      requestedByUserId: admin.id,
      destination: data.destination,
      note: data.note,
      byAdmin: true,
    });
    return NextResponse.json(payout, { status: 201 });
  });
}
