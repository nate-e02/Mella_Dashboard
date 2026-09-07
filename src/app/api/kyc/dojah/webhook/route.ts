import { NextRequest, NextResponse } from "next/server";
import { dojahKycProvider } from "@/lib/services/dojahKycProvider";
import { handleVerifiedProviderWebhook } from "@/lib/services/kycVerification";

/**
 * Server-to-server webhook per
 * https://docs.dojah.io/api-reference/core-concepts/webhooks-signatures.
 *
 * The raw body is read (and its signature checked) BEFORE any JSON parsing -
 * signature verification depends on the exact bytes Dojah sent, not a
 * re-serialized copy. An unverified request is rejected outright and never
 * reaches the KYC state machine; the client-side widget callback is never
 * trusted as proof of verification, only this signed webhook is.
 *
 * Dojah may retry delivery, so this always returns 200 once the payload has
 * been authenticated, whether or not it resulted in a change -
 * `handleVerifiedProviderWebhook` is idempotent and safe to call any number
 * of times for the same reference (see kycVerification.ts).
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

  try {
    await handleVerifiedProviderWebhook(rawBody);
  } catch (err) {
    console.error("Dojah webhook processing error:", err instanceof Error ? err.message : err);
    // Still acknowledge receipt - retrying won't help a local processing
    // error, and the trader/admin can retry verification separately.
  }

  return NextResponse.json({ received: true });
}
