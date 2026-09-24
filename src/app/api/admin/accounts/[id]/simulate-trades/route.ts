import { NextRequest, NextResponse } from "next/server";
import { assertDevOverridesEnabled, requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { simulateTrades } from "@/lib/services/trades";
import { z } from "zod";

const schema = z.object({
  count: z.number().int().min(1).max(100).default(10),
  winBias: z.number().min(0).max(1).default(0.6),
});

/** Development-only demo trade generator; 404 unless ENABLE_DEV_OVERRIDES=true outside production. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    assertDevOverridesEnabled();
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const { count, winBias } = schema.parse(body);
    const updated = await simulateTrades(id, count, winBias, admin.id);
    return NextResponse.json(updated);
  });
}
