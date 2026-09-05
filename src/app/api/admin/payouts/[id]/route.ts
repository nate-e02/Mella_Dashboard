import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { decidePayout } from "@/lib/services/payouts";
import { z } from "zod";

const schema = z.object({ status: z.enum(["PAID", "REJECTED"]) });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const { status } = schema.parse(body);
    const updated = await decidePayout(id, status, admin.id);
    return NextResponse.json(updated);
  });
}
