import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { fxRateSchema } from "@/lib/validation/schemas";
import { getUsdEtbRate, setUsdEtbRate } from "@/lib/services/settings";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await getUsdEtbRate());
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { rate, source } = fxRateSchema.parse(await req.json());
    return NextResponse.json(await setUsdEtbRate(rate, source, admin.id), { status: 201 });
  });
}
