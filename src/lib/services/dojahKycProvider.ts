import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { KycProvider, KycSessionConfig, NormalizedKycResult } from "@/lib/services/kycProvider";

/**
 * Dojah (https://docs.dojah.io) implementation of the KycProvider interface,
 * using Dojah's "Hosted Flow / EasyOnboard" widget for Ethiopian Fayda ID
 * verification (Dojah has no separate, dedicated single-call REST lookup
 * endpoint for Fayda documented at the time this was written - unlike their
 * Nigeria/Ghana/Kenya/etc. country-specific lookup endpoints, Ethiopia's
 * government-ID + biometric verification is delivered through this
 * configurable hosted flow, per docs.dojah.io/api-reference/hosted-flows-easyonboard).
 *
 * That flow is client-widget-driven: this provider never makes an outbound
 * REST call to Dojah at all. Starting a session just returns the config the
 * browser needs to launch Dojah's own hosted widget (script:
 * https://widget.dojah.io/widget.js); the actual verification happens
 * inside that widget, using Dojah's own UI. Per Dojah's own documentation,
 * the client-side `onSuccess` callback is NOT proof of verification - the
 * only authoritative result is the signed webhook this provider verifies
 * and parses below.
 */

function getConfig() {
  const appId = process.env.DOJAH_APP_ID;
  const publicKey = process.env.DOJAH_PUBLIC_KEY;
  const secretKey = process.env.DOJAH_SECRET_KEY;
  const widgetId = process.env.DOJAH_WIDGET_ID;
  if (!appId || !publicKey || !secretKey || !widgetId) {
    throw new Error("Dojah is not configured (DOJAH_APP_ID / DOJAH_PUBLIC_KEY / DOJAH_SECRET_KEY / DOJAH_WIDGET_ID)");
  }
  return { appId, publicKey, secretKey, widgetId };
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Dojah's documented `verification_status` values for a hosted-flow (KYC
 * widget) event: Ongoing, Pending, Completed, Failed, Abandoned. Per their
 * own docs, "Completed means finished, not passed" - the top-level boolean
 * `status` (and per-step statuses) must also be checked.
 */
type DojahWebhookPayload = {
  reference_id?: unknown;
  verification_status?: unknown;
  status?: unknown;
  data?: Record<string, { status?: boolean; message?: string }> | undefined;
};

function normalizeOutcome(payload: DojahWebhookPayload): NormalizedKycResult {
  const verificationStatus = typeof payload.verification_status === "string" ? payload.verification_status : "";
  const overallPassed = payload.status === true;

  if (verificationStatus === "Ongoing" || verificationStatus === "Pending") {
    return { outcome: "PENDING" };
  }

  if (verificationStatus === "Completed" && overallPassed) {
    return { outcome: "VERIFIED" };
  }

  if (verificationStatus === "Completed" && !overallPassed) {
    // Identify which step failed as a safe category - never the step's
    // actual data (names, ID numbers, document/selfie URLs).
    const failedStep = payload.data
      ? Object.entries(payload.data).find(([, step]) => step && step.status === false)?.[0]
      : undefined;
    return { outcome: "FAILED", failureReason: failedStep ? `${failedStep}_verification_failed` : "verification_failed" };
  }

  if (verificationStatus === "Failed") {
    return { outcome: "FAILED", failureReason: "provider_reported_failed" };
  }

  if (verificationStatus === "Abandoned") {
    return { outcome: "FAILED", failureReason: "abandoned_by_user" };
  }

  // Unrecognized/future status value - treat as still in progress rather
  // than guessing at a pass/fail outcome.
  return { outcome: "PENDING" };
}

export const dojahKycProvider: KycProvider = {
  name: "DOJAH",

  async createVerificationSession(input): Promise<KycSessionConfig> {
    const { appId, publicKey, widgetId } = getConfig();
    // No outbound API call - the widget itself talks to Dojah directly
    // using these client-safe values (app_id and the public key are
    // explicitly documented by Dojah as safe for frontend use; the secret
    // key never leaves this module). See dojahKycProvider docstring above.
    return {
      appId,
      publicKey,
      widgetId,
      referenceId: input.referenceId,
      // "custom" is Dojah's documented general-purpose widget type; the
      // actual verification steps performed (Ethiopian Fayda ID + biometric)
      // are configured against `widgetId` in the Dojah dashboard, not here.
      type: "custom",
      userData: { first_name: input.user.name.split(/\s+/)[0], email: input.user.email },
    };
  },

  verifyWebhookSignature(rawBody, headers): boolean {
    const { secretKey } = getConfig();

    const bodySignature = headers.get("x-dojah-signature");
    if (bodySignature) {
      const expected = createHmac("sha256", secretKey).update(rawBody).digest("hex");
      if (safeCompare(expected, bodySignature)) return true;
    }

    const keySignature = headers.get("x-dojah-signature-v2");
    if (keySignature) {
      const expected = createHmac("sha256", secretKey).update(secretKey).digest("hex");
      if (safeCompare(expected, keySignature)) return true;
    }

    return false;
  },

  parseWebhookPayload(rawBody) {
    let payload: DojahWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const referenceId = typeof payload.reference_id === "string" ? payload.reference_id : null;
    if (!referenceId) return null;

    return { referenceId, result: normalizeOutcome(payload) };
  },
};
