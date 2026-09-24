import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { deleteEconomicEvent } from "@/lib/services/newsCalendar";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await deleteEconomicEvent(id, admin.id);
    return NextResponse.json({ ok: true });
  });
}
