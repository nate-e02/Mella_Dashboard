// Development-only KYC override: returns 404 unless ENABLE_DEV_OVERRIDES=true
// outside production (see assertDevOverridesEnabled). Every use is audited.
import { NextRequest, NextResponse } from "next/server";
import { assertDevOverridesEnabled, requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { adminOverrideKycStatus } from "@/lib/services/kycVerification";
import { kycOverrideSchema } from "@/lib/validation/schemas";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    assertDevOverridesEnabled();
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const data = kycOverrideSchema.parse(await req.json());
    const updated = await adminOverrideKycStatus(id, data.status, admin.id, data.reason);
    return NextResponse.json(updated);
  });
}
