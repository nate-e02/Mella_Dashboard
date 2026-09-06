import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Thin server-side client for the Chapa payment API
 * (https://developer.chapa.co). Deliberately minimal - just the three
 * operations this integration needs (initialize, verify, webhook signature
 * check) - rather than a general payment-provider abstraction.
 *
 * The secret key is read from `CHAPA_SECRET_KEY` and is never sent to the
 * browser; every function here is server-only.
 */

const CHAPA_API_BASE = "https://api.chapa.co/v1";

/** Currency for all Chapa charges in this app - no conversion is performed. */
export const CHAPA_CURRENCY = "ETB";

export class ChapaApiError extends Error {}

function getSecretKey(): string {
  const key = process.env.CHAPA_SECRET_KEY;
  if (!key) throw new ChapaApiError("CHAPA_SECRET_KEY is not configured");
  return key;
}

export type ChapaInitializeParams = {
  /** Authoritative amount in ETB, already resolved server-side - never client input. */
  amount: number;
  txRef: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  callbackUrl: string;
  returnUrl: string;
};

/**
 * POST https://api.chapa.co/v1/transaction/initialize
 * https://developer.chapa.co/integrations/accept-payments
 */
export async function initializeChapaTransaction(params: ChapaInitializeParams): Promise<{ checkoutUrl: string }> {
  let res: Response;
  try {
    res = await fetch(`${CHAPA_API_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amount.toFixed(2),
        currency: CHAPA_CURRENCY,
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        tx_ref: params.txRef,
        callback_url: params.callbackUrl,
        return_url: params.returnUrl,
      }),
    });
  } catch (err) {
    throw new ChapaApiError(`Chapa initialize request failed: ${err instanceof Error ? err.message : "network error"}`);
  }

  const body: unknown = await res.json().catch(() => null);
  const checkoutUrl = (body as { data?: { checkout_url?: string } } | null)?.data?.checkout_url;
  const status = (body as { status?: string } | null)?.status;

  if (!res.ok || status !== "success" || !checkoutUrl) {
    console.error(
      "Chapa initialize did not return a checkout URL:",
      res.status,
      (body as { message?: unknown } | null)?.message ?? "(no message)",
    );
    throw new ChapaApiError("Chapa did not return a checkout URL");
  }

  return { checkoutUrl };
}

export type ChapaPaymentStatus = "success" | "failed" | "pending" | "unknown";

export type ChapaVerification = {
  paymentStatus: ChapaPaymentStatus;
  amount: number;
  currency: string;
  txRef: string;
};

/**
 * GET https://api.chapa.co/v1/transaction/verify/<tx_ref>
 * https://developer.chapa.co/integrations/verify-payments
 *
 * This is the only source of truth for "did this payment actually succeed" -
 * the browser return redirect and the webhook payload are both only hints
 * that trigger this call; they are never trusted on their own.
 */
export async function verifyChapaTransaction(txRef: string): Promise<ChapaVerification> {
  let res: Response;
  try {
    res = await fetch(`${CHAPA_API_BASE}/transaction/verify/${encodeURIComponent(txRef)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${getSecretKey()}` },
    });
  } catch (err) {
    throw new ChapaApiError(`Chapa verify request failed: ${err instanceof Error ? err.message : "network error"}`);
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok || !body) {
    console.error("Chapa verify request returned an error:", res.status, (body as { message?: unknown } | null)?.message);
    throw new ChapaApiError("Unable to verify Chapa transaction");
  }

  const data = (body as { data?: Record<string, unknown> }).data ?? {};
  const rawStatus = String(data.status ?? (body as { status?: unknown }).status ?? "").toLowerCase();
  const paymentStatus: ChapaPaymentStatus =
    rawStatus === "success" ? "success" : rawStatus === "pending" ? "pending" : rawStatus === "failed" ? "failed" : "unknown";

  return {
    paymentStatus,
    amount: Number(data.amount ?? 0),
    currency: String(data.currency ?? ""),
    txRef: String(data.tx_ref ?? txRef),
  };
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a Chapa webhook request per
 * https://developer.chapa.co/integrations/webhooks.
 *
 * Chapa sends two possible headers, and documents that either one being
 * valid is sufficient:
 *  - `x-chapa-signature`: HMAC-SHA256 of the raw JSON request body, keyed
 *    with the secret key.
 *  - `chapa-signature`: HMAC-SHA256 of the secret key itself, keyed with
 *    the secret key.
 *
 * `rawBody` must be the exact bytes/string Chapa sent (read before any JSON
 * parsing) - re-serializing a parsed object can silently change key order
 * or whitespace and break the signature comparison.
 */
export function verifyChapaWebhookSignature(rawBody: string, headers: { get(name: string): string | null }): boolean {
  const secret = getSecretKey();

  const bodySignature = headers.get("x-chapa-signature");
  if (bodySignature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (safeCompare(expected, bodySignature)) return true;
  }

  const keySignature = headers.get("chapa-signature");
  if (keySignature) {
    const expected = createHmac("sha256", secret).update(secret).digest("hex");
    if (safeCompare(expected, keySignature)) return true;
  }

  return false;
}
