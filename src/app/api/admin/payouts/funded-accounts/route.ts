import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listFundedAccountsForPayout } from "@/lib/services/payouts";
import { paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = paginationSchema.parse({ ...Object.fromEntries(searchParams), pageSize: searchParams.get("pageSize") ?? "50" });
    return NextResponse.json(await listFundedAccountsForPayout({ page, pageSize }));
  });
}
