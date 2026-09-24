import { NextRequest, NextResponse } from "next/server";
import { otpVerifySchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { loginResponseBody } from "@/lib/services/auth";
import { loginWithPhoneOtp } from "@/lib/services/phoneAuth";

/**
 * Step 2: check the code. Known number → the same outcomes and body as
 * /api/auth/login (session, MFA challenge, disabled). Unknown number →
 * `{ needsProfile: true }` plus a 15-minute signed proof cookie that
 * /api/auth/otp/complete exchanges for a new account.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { phone, code } = otpVerifySchema.parse(await req.json());
    const result = await loginWithPhoneOtp(phone, code);

    switch (result.outcome) {
      case "INVALID":
        return NextResponse.json({ error: "Invalid or expired code", code: "INVALID_CODE" }, { status: 401 });
      case "DISABLED":
        return NextResponse.json({ error: "This account has been disabled. Contact support." }, { status: 403 });
      case "MFA_REQUIRED":
        return NextResponse.json({ mfaRequired: true });
      case "NEEDS_PROFILE":
        return NextResponse.json({ needsProfile: true });
      case "SESSION":
        return NextResponse.json(loginResponseBody(result.user));
    }
  });
}
