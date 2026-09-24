import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listPurchasedRecords } from "@/lib/services/crm";
import { enumParam, paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"], searchParams.get("status"));
    const result = await listPurchasedRecords({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}
