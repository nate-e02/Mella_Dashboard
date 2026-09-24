import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getReferralCommissionPercent, setReferralCommissionPercent } from "@/lib/services/referrals";
import { referralSettingsSchema } from "@/lib/validation/growth";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json({ commissionPercent: await getReferralCommissionPercent() });
  });
}

export async function PUT(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { commissionPercent } = referralSettingsSchema.parse(await req.json());
    return NextResponse.json({ commissionPercent: await setReferralCommissionPercent(commissionPercent, admin.id) });
  });
}
