import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { findPurchaseByTxRefForUser, verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";

/**
 * Called by the purchases page after the trader returns from Chapa checkout.
 * Authenticated and ownership-checked, so an unauthenticated GET with a
 * tx_ref can no longer trigger verification (or force a pending purchase
 * into FAILED). The Chapa webhook remains the authoritative path; this only
 * speeds up the customer's own view.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ txRef: string }> }) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { txRef } = await ctx.params;
    const purchase = await findPurchaseByTxRefForUser(txRef, user.id);
    if (!purchase) return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    const result = await verifyAndCompleteChapaPurchase(txRef);
    return NextResponse.json(result);
  });
}
