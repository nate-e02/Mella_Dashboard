import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { listAuditLogs } from "@/lib/services/audit";
import { paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse({ ...Object.fromEntries(searchParams), pageSize: searchParams.get("pageSize") ?? "25" });
    const action = searchParams.get("action") ?? undefined;
    const targetType = searchParams.get("targetType") ?? undefined;
    const actorId = searchParams.get("actorId") ?? undefined;
    return NextResponse.json(await listAuditLogs({ page, pageSize, search, action, targetType, actorId }));
  });
}
