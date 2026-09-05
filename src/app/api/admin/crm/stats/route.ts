import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getCrmStats } from "@/lib/services/crm";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    return NextResponse.json(await getCrmStats());
  });
}
