import { NextRequest, NextResponse } from "next/server";
import { verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";

/**
 * Chapa's per-transaction `callback_url`: a server-to-server GET with
 * `?trx_ref=...&ref_id=...&status=...` after a payment. The query string is
 * only a hint: the purchase is completed solely by `verifyAndCompleteChapaPurchase`,
 * which re-verifies the transaction with Chapa's API and cross-checks amount
 * and currency, so a forged call can never activate or fail anything that
 * Chapa itself does not report. Rate-limited per IP in proxy.ts.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const txRef = params.get("trx_ref") ?? params.get("tx_ref");
  if (!txRef || !/^[A-Za-z0-9_-]{8,100}$/.test(txRef)) {
    return NextResponse.json({ error: "Missing or invalid trx_ref" }, { status: 400 });
  }
  try {
    const result = await verifyAndCompleteChapaPurchase(txRef);
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    console.error("Chapa callback processing error for tx_ref", txRef, err instanceof Error ? err.message : err);
    return NextResponse.json({ received: true });
  }
}
