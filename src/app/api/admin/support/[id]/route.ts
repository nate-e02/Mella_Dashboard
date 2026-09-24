import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { supportTicketUpdateSchema } from "@/lib/validation/schemas";
import { updateTicket } from "@/lib/services/support";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const data = supportTicketUpdateSchema.parse(await req.json());
    return NextResponse.json(await updateTicket(id, data, admin.id));
  });
}
