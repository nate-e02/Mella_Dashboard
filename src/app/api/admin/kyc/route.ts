import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listKycSubmissions } from "@/lib/services/kyc";
import { enumParam, paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["PENDING", "APPROVED", "REJECTED"], searchParams.get("status"));
    const result = await listKycSubmissions({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}
