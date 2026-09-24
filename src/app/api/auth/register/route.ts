import { NextRequest, NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { registerUser } from "@/lib/services/auth";
import { REFERRAL_COOKIE, attachReferral } from "@/lib/services/referrals";
import { getLocale } from "@/i18n/server";

/**
 * Always responds 201 with the same body shape whether the address was new or
 * already registered (an existing account gets an email instead), so this
 * endpoint cannot be used to enumerate customers. A session cookie is only
 * set when an account was actually created.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const data = registerSchema.parse(await req.json());
    const result = await registerUser({ ...data, locale: await getLocale() });
    if (result.created && result.userId) await attachReferral(result.userId, req.cookies.get(REFERRAL_COOKIE)?.value);
    return NextResponse.json({ ok: true, next: "/dashboard" }, { status: 201 });
  });
}
