import "server-only";
import { NextResponse } from "next/server";
import { formatPhone } from "@/lib/phone";
import type { RequestOtpResult } from "@/lib/services/phoneOtp";

/**
 * HTTP mapping shared by every "send me a code" endpoint. Success says where
 * the code went (the number the caller typed, normalised) and when a resend
 * is allowed; throttling answers 429 with `retryAfterSec` so the UI can run
 * its countdown.
 */
export function otpRequestResponse(result: RequestOtpResult): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, phone: formatPhone(result.phone), expiresInSec: result.expiresInSec, retryAfterSec: result.retryAfterSec });
  }
  switch (result.reason) {
    case "INVALID_PHONE":
      return NextResponse.json({ error: "Enter a valid phone number", code: result.reason }, { status: 400 });
    case "COOLDOWN":
    case "HOURLY_LIMIT": {
      const res = NextResponse.json(
        {
          error: result.reason === "COOLDOWN" ? "Please wait before requesting another code" : "Too many codes requested for this number. Try again later.",
          code: result.reason,
          retryAfterSec: result.retryAfterSec,
        },
        { status: 429 },
      );
      res.headers.set("Retry-After", String(result.retryAfterSec));
      return res;
    }
    case "UNAVAILABLE":
      return NextResponse.json({ error: "SMS login is temporarily unavailable. Use email instead.", code: result.reason }, { status: 503 });
    case "SEND_FAILED":
      return NextResponse.json({ error: "We could not send the SMS. Check the number and try again.", code: result.reason }, { status: 502 });
  }
}
