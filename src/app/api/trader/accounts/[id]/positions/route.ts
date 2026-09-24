import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { prisma } from "@/lib/prisma";
import { listClosedTradesSince, listOpenPositions } from "@/lib/services/accountState";
import { currentDayStart, parseResetTime } from "@/lib/services/dailyReset";

const querySchema = z.object({ status: z.enum(["OPEN", "CLOSED"]).default("OPEN") });

/**
 * `GET /api/trader/accounts/[id]/positions` -> open positions (`PositionInfo[]`).
 * `?status=CLOSED` -> trades closed since the account's current daily-reset
 * boundary, with a summary (the terminal's "Closed today" panel).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { id } = await ctx.params;

    const account = await prisma.tradingAccount.findUnique({ where: { id }, select: { userId: true, snapshot: true } });
    assertOwnsResource(account?.userId, user.id);

    const { status } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    if (status === "CLOSED") {
      const resetTime = parseResetTime((account?.snapshot as { dailyLossResetTime?: string } | null)?.dailyLossResetTime);
      const summary = await listClosedTradesSince(id, currentDayStart(resetTime));
      return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
    }

    const positions = await listOpenPositions(id);
    return NextResponse.json(positions, { headers: { "Cache-Control": "no-store" } });
  });
}
