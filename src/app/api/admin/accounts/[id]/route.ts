import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getAccountById } from "@/lib/services/accounts";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const account = await getAccountById(id);
    if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(account);
  });
}
