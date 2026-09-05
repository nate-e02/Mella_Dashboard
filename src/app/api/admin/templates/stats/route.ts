import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getTemplateStats } from "@/lib/services/templates";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const stats = await getTemplateStats();
    return NextResponse.json(stats);
  });
}
