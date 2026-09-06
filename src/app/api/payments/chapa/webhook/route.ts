import { NextRequest, NextResponse } from "next/server";
import { verifyChapaWebhookSignature } from "@/lib/services/chapa";
import { verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";

/**
 * Server-to-server webhook per https://developer.chapa.co/integrations/webhooks.
 *
 * The raw body is read (and checked) BEFORE any JSON parsing - signature
 * verification depends on the exact bytes Chapa sent, not a re-serialized
 * copy. An unverified request is rejected outright and never reaches the
 * purchase-completion logic.
 *
 * Chapa may retry delivery, so this always returns 200 once the payload has
 * been authenticated and looked up, whether or not it resulted in a change -
 * `verifyAndCompleteChapaPurchase` is idempotent and safe to call any number
 * of times for the same tx_ref (see purchases.ts).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let signatureValid: boolean;
  try {
    signatureValid = verifyChapaWebhookSignature(rawBody, req.headers);
  } catch (err) {
    console.error("Chapa webhook signature check could not run:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid request" }, { status: 401 });
  }

  if (!signatureValid) {
    console.error("Chapa webhook received with a missing or invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { tx_ref?: unknown } | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const txRef = typeof payload?.tx_ref === "string" ? payload.tx_ref : null;
  if (!txRef) {
    return NextResponse.json({ received: true });
  }

  try {
    await verifyAndCompleteChapaPurchase(txRef);
  } catch (err) {
    console.error("Chapa webhook processing error for tx_ref", txRef, err instanceof Error ? err.message : err);
    // Still acknowledge receipt - retrying an internal error won't help,
    // and the return-flow / a manual admin check remain as backstops.
  }

  return NextResponse.json({ received: true });
}
