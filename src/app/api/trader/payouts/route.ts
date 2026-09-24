import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { createPayout, listPayoutsForUser } from "@/lib/services/payouts";
import { traderPayoutRequestSchema } from "@/lib/validation/schemas";

export async function GET() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    return NextResponse.json(await listPayoutsForUser(user.id));
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const data = traderPayoutRequestSchema.parse(await req.json());
    const payout = await createPayout({
      tradingAccountId: data.tradingAccountId,
      amount: data.amount,
      requestedByUserId: user.id,
      destination: data.destination,
    });
    return NextResponse.json(payout, { status: 201 });
  });
}
