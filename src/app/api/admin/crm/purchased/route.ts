import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listPurchasedRecords } from "@/lib/services/crm";
import { paginationSchema } from "@/lib/validation/schemas";
import type { PurchaseStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = (searchParams.get("status") as PurchaseStatus | "ALL") ?? "ALL";
    const result = await listPurchasedRecords({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}
