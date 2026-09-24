import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { enumParam, paginationSchema } from "@/lib/validation/schemas";
import { listTickets } from "@/lib/services/support";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = enumParam(["OPEN", "PENDING", "RESOLVED", "CLOSED"], searchParams.get("status"));
    return NextResponse.json(await listTickets({ page, pageSize, search, status }));
  });
}
