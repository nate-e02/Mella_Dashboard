import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createCoupon, listCoupons } from "@/lib/services/coupons";
import { enumParam, paginationSchema } from "@/lib/validation/schemas";
import { couponCreateSchema } from "@/lib/validation/growth";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["ACTIVE", "INACTIVE"], searchParams.get("status"));
    return NextResponse.json(await listCoupons({ page, pageSize, search, status }));
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const data = couponCreateSchema.parse(await req.json());
    return NextResponse.json(await createCoupon(data, admin.id), { status: 201 });
  });
}
