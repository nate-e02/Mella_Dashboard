// TEMPORARY DEVELOPMENT KYC OVERRIDE — REMOVE BEFORE PRODUCTION.
// See the matching notice in src/lib/services/kycVerification.ts. This
// route can be deleted independently of the real Dojah KYC integration.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { adminOverrideKycStatus } from "@/lib/services/kycVerification";
import { kycOverrideSchema } from "@/lib/validation/schemas";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const data = kycOverrideSchema.parse(body);
    const updated = await adminOverrideKycStatus(id, data.status, admin.id, data.reason);
    return NextResponse.json(updated);
  });
}
