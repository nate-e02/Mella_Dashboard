import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createPayout, listPayouts } from "@/lib/services/payouts";
import { z } from "zod";

const createPayoutSchema = z.object({
  tradingAccountId: z.string().min(1),
  amount: z.number().positive(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await listPayouts());
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const data = createPayoutSchema.parse(body);
    const payout = await createPayout(data.tradingAccountId, data.amount, admin.id);
    return NextResponse.json(payout, { status: 201 });
  });
}
