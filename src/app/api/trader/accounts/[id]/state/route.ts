import { NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { prisma } from "@/lib/prisma";
import { computeAccountState } from "@/lib/services/accountState";

/** Full `AccountState` for one of the trader's own accounts (initial terminal render before the socket connects). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { id } = await ctx.params;

    const account = await prisma.tradingAccount.findUnique({ where: { id }, select: { userId: true } });
    assertOwnsResource(account?.userId, user.id);

    const state = await computeAccountState(id);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  });
}
