import { NextRequest } from "next/server";
import { otpRequestSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { requestContext } from "@/lib/auth/session";
import { otpRequestResponse } from "@/lib/auth/otpHttp";
import { requestPhoneOtp } from "@/lib/services/phoneOtp";
import { getLocale } from "@/i18n/server";

/**
 * Step 1 of phone login / sign-up: text a 6-digit code. Answers the same for
 * registered and unknown numbers. Per-IP limits are in src/proxy.ts; the
 * per-number cooldown and hourly cap are enforced by the service.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { phone } = otpRequestSchema.parse(await req.json());
    const [ctx, locale] = await Promise.all([requestContext(), getLocale()]);
    const result = await requestPhoneOtp({ phone, purpose: "LOGIN", ip: ctx.ip, locale });
    return otpRequestResponse(result);
  });
}
