import { NextRequest, NextResponse } from "next/server";
import { verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";

/**
 * The browser lands here after Chapa's hosted checkout (the `return_url` we
 * supplied at initialization already has our own `tx_ref` baked in, so this
 * doesn't depend on whatever query params Chapa itself appends).
 *
 * This is a redirect target, not an API the trader's session gates access
 * to: it can only ever reflect a payment status Chapa itself verifies
 * server-side here, it cannot fabricate one, so no auth check is needed or
 * appropriate here (the same is true of the webhook route below). The
 * account is never created just because the browser landed on this URL -
 * only `verifyAndCompleteChapaPurchase` decides that, via a real
 * server-to-server verification call.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const txRef = searchParams.get("tx_ref");
  const appUrl = process.env.APP_URL || new URL(req.url).origin;

  if (!txRef) {
    return NextResponse.redirect(`${appUrl}/purchases?payment=error`);
  }

  try {
    const result = await verifyAndCompleteChapaPurchase(txRef);
    const payment =
      result.outcome === "PAID" || result.outcome === "ALREADY_PAID"
        ? "success"
        : result.outcome === "PENDING"
          ? "pending"
          : result.outcome === "FAILED" || result.outcome === "TERMINAL"
            ? "failed"
            : "error";
    return NextResponse.redirect(`${appUrl}/purchases?payment=${payment}`);
  } catch (err) {
    console.error("Chapa return handler error for tx_ref", txRef, err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${appUrl}/purchases?payment=error`);
  }
}
