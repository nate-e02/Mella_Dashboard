import { NextRequest, NextResponse } from "next/server";
import { appUrl, isProduction } from "@/env";
import { normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_SEC } from "@/lib/services/referrals";

/**
 * Referral link: remembers the code for 30 days and sends the visitor to
 * sign-up, where attachReferral() credits the referrer. Only well-formed
 * codes are stored; unknown ones are ignored at sign-up. An existing cookie
 * is replaced (last click wins).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  // Absolute public URL: behind the reverse proxy req.url carries the internal host.
  const res = NextResponse.redirect(new URL("/register", appUrl()), 307);
  const normalized = normalizeReferralCode(code);
  if (normalized) {
    res.cookies.set(REFERRAL_COOKIE, normalized, {
      maxAge: REFERRAL_COOKIE_MAX_AGE_SEC,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
    });
  }
  res.headers.set("Cache-Control", "no-store");
  return res;
}
