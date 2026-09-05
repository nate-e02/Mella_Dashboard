import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getOverviewStats } from "@/lib/services/stats";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await getOverviewStats());
  });
}
