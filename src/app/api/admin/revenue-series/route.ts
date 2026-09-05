import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getRevenueSeries } from "@/lib/services/stats";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await getRevenueSeries(30));
  });
}
