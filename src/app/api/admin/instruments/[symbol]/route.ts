import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { setInstrumentBackupFeed } from "@/lib/services/instruments";

const patchSchema = z.object({
  backupFeedSource: z.string().trim().max(32).nullable(),
  backupFeedSymbol: z.string().trim().max(64).nullable().optional(),
});

/** Admin: set or clear an instrument's backup (hot-standby) feed. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { symbol } = await ctx.params;
    const body = patchSchema.parse(await req.json());
    const updated = await setInstrumentBackupFeed(
      decodeURIComponent(symbol).toUpperCase(),
      { backupFeedSource: body.backupFeedSource || null, backupFeedSymbol: body.backupFeedSymbol ?? null },
      admin.id,
    );
    return NextResponse.json({ symbol: updated.symbol, feedSource: updated.feedSource, backupFeedSource: updated.backupFeedSource, backupFeedSymbol: updated.backupFeedSymbol });
  });
}
