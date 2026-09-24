import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { decideReferralReward } from "@/lib/services/referrals";
import { referralDecisionSchema } from "@/lib/validation/growth";

/** Approve (maker), mark paid (checker - a different admin) or void a referral reward. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const { action, note, providerRef } = referralDecisionSchema.parse(await req.json());
    return NextResponse.json(await decideReferralReward(id, action, admin.id, { note, providerRef }));
  });
}
