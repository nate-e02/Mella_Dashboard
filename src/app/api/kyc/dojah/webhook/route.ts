import { NextRequest, NextResponse } from "next/server";
import { dojahKycProvider } from "@/lib/services/dojahKycProvider";
import { handleVerifiedProviderWebhook } from "@/lib/services/kycVerification";
import { claimWebhookDelivery } from "@/lib/services/webhooks";

/**
 * Server-to-server webhook per Dojah's webhook-signature docs. Only the
 * body-bound `x-dojah-signature` HMAC is accepted, and each delivery is
 * recorded so a replayed body is acknowledged but never re-applied.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let signatureValid: boolean;
  try {
    signatureValid = dojahKycProvider.verifyWebhookSignature(rawBody, req.headers);
  } catch (err) {
    console.error("Dojah webhook signature check could not run:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invalid request" }, { status: 401 });
  }
  if (!signatureValid) {
    console.error("Dojah webhook received with a missing or invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const fresh = await claimWebhookDelivery("DOJAH", rawBody);
  if (!fresh) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handleVerifiedProviderWebhook(rawBody);
  } catch (err) {
    console.error("Dojah webhook processing error:", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ received: true });
}
