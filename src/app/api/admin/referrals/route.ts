import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listReferralRewards } from "@/lib/services/referrals";
import { enumParam, paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["PENDING", "APPROVED", "PAID", "VOID"], searchParams.get("status"));
    return NextResponse.json(await listReferralRewards({ page, pageSize, status }));
  });
}
