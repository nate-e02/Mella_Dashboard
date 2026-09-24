import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { prisma } from "@/lib/prisma";
import { computePayoutAvailability, MIN_FUNDED_DAYS_BEFORE_PAYOUT, MIN_PAYOUT_ETB } from "@/lib/services/payouts";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const accountId = new URL(req.url).searchParams.get("accountId") ?? "";
    const account = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { userId: true } });
    assertOwnsResource(account?.userId, user.id);
    const a = await computePayoutAvailability(accountId);
    return NextResponse.json({
      available: a.available,
      profit: a.profit,
      traderShare: a.traderShare,
      alreadyCommitted: a.alreadyCommitted,
      profitSplitPercent: a.profitSplitPercent,
      kycApproved: a.kycApproved,
      fundedDays: a.fundedDays,
      eligible: a.eligible,
      minPayout: MIN_PAYOUT_ETB,
      minFundedDays: MIN_FUNDED_DAYS_BEFORE_PAYOUT,
    });
  });
}
