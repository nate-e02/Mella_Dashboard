import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { prisma } from "@/lib/prisma";
import { listTradesForAccount, resolveTimeframe, type TimeframeKey } from "@/lib/services/trades";
import { paginationSchema } from "@/lib/validation/schemas";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { id } = await ctx.params;

    const account = await prisma.tradingAccount.findUnique({ where: { id }, select: { userId: true } });
    assertOwnsResource(account?.userId, user.id);

    const { searchParams } = new URL(req.url);
    const { page, pageSize } = paginationSchema.parse(Object.fromEntries(searchParams));
    const timeframe = (searchParams.get("timeframe") as TimeframeKey) || "this_month";
    const { from, to } = resolveTimeframe(timeframe, searchParams.get("from") ?? undefined, searchParams.get("to") ?? undefined);

    const result = await listTradesForAccount({ accountId: id, from, to, page, pageSize });
    return NextResponse.json(result);
  });
}
