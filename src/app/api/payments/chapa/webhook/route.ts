import { NextRequest, NextResponse } from "next/server";
import { verifyChapaWebhookSignature } from "@/lib/services/chapa";
import { verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";
import { claimWebhookDelivery } from "@/lib/services/webhooks";

/**
 * Server-to-server webhook per https://developer.chapa.co/integrations/webhooks.
 * The raw body is signature-checked BEFORE any JSON parsing; an unverified
 * request never reaches the purchase logic. Duplicate deliveries are
 * detected by the WebhookDelivery table and acknowledged without re-processing.
 * `verifyAndCompleteChapaPurchase` re-verifies the payment with Chapa's API
 * and never trusts this payload's own claimed status.
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

  let payload: { tx_ref?: unknown; reference?: unknown; event?: unknown } | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const txRef = typeof payload?.tx_ref === "string" ? payload.tx_ref : null;
  if (!txRef) return NextResponse.json({ received: true });

  const eventKey = typeof payload?.reference === "string" ? `${payload.reference}:${String(payload.event ?? "")}` : null;
  const fresh = await claimWebhookDelivery("CHAPA", rawBody, eventKey);
  if (!fresh) return NextResponse.json({ received: true, duplicate: true });

  try {
    await verifyAndCompleteChapaPurchase(txRef);
  } catch (err) {
    console.error("Chapa webhook processing error for tx_ref", txRef, err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ received: true });
}
