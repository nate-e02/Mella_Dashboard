import { NextRequest, NextResponse } from "next/server";
import { phoneSignupCompleteSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { loginResponseBody } from "@/lib/services/auth";
import { completePhoneSignup } from "@/lib/services/phoneAuth";
import { REFERRAL_COOKIE } from "@/lib/services/referrals";
import { getLocale } from "@/i18n/server";

/**
 * Step 3 for a new number: name (+ optional email) → account + session. The
 * phone comes only from the signed proof cookie set by /api/auth/otp/verify.
 * `emailAttached: false` never says why (the address may belong to someone else).
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const data = phoneSignupCompleteSchema.parse(await req.json());
    const result = await completePhoneSignup({
      name: data.name,
      email: data.email,
      locale: await getLocale(),
      referralCode: req.cookies.get(REFERRAL_COOKIE)?.value,
    });

    switch (result.outcome) {
      case "EXPIRED":
        return NextResponse.json({ error: "Your phone verification expired. Request a new code.", code: "PHONE_PROOF_EXPIRED" }, { status: 401 });
      case "PHONE_TAKEN":
        return NextResponse.json({ error: "This phone number is already registered. Log in with it again.", code: "PHONE_TAKEN" }, { status: 409 });
      case "CREATED":
        return NextResponse.json({ ...loginResponseBody(result.user), emailAttached: result.emailAttached, next: "/dashboard" }, { status: 201 });
    }
  });
}
