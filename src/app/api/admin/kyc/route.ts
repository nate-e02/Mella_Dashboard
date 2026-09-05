import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listKycSubmissions } from "@/lib/services/kyc";
import { paginationSchema } from "@/lib/validation/schemas";
import type { KycStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = (searchParams.get("status") as KycStatus | "ALL") ?? "ALL";
    const result = await listKycSubmissions({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}
