import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { getBars } from "@/lib/services/market";
import { TIMEFRAMES } from "@/trading/protocol";

const querySchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{3,12}$/, "symbol must be 3-12 uppercase letters/digits"),
  tf: z.enum(TIMEFRAMES),
  limit: z.coerce.number().int().min(1).max(1500).default(500),
  /** Unix seconds; returns bars strictly before this bucket. */
  before: z.coerce.number().int().positive().optional(),
});

/** Historical candles: `?symbol=EURUSD&tf=5m&limit=500&before=<unix seconds>` (any authenticated user). */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireUser();
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse(Object.fromEntries(searchParams));
    const bars = await getBars(query.symbol, query.tf, {
      limit: query.limit,
      before: query.before ? new Date(query.before * 1000) : undefined,
    });
    return NextResponse.json(bars, { headers: { "Cache-Control": "no-store" } });
  });
}
