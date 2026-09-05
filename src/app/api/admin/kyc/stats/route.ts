import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getKycStats } from "@/lib/services/kyc";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await getKycStats());
  });
}
