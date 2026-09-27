import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { ConflictError } from "@/lib/errors";
import { buildAuthorizeUrl, ctraderApp } from "@/lib/services/ctraderAuth";
import { CTRADER_STATE_COOKIE, CTRADER_STATE_TTL_SEC } from "@/lib/services/ctraderOAuthCookie";

/**
 * Admin: start the cTrader Open API OAuth flow. Redirects to id.ctrader.com;
 * cTrader sends the admin back to CTRADER_REDIRECT_URI (/api/ctrader/callback).
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const app = ctraderApp();
    if (!app) throw new ConflictError("Set CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET first");
    if (!app.redirectUri) throw new ConflictError("Set CTRADER_REDIRECT_URI (e.g. https://<domain>/api/ctrader/callback) and register it in the cTrader app");
    const state = randomBytes(24).toString("hex");
    const res = NextResponse.redirect(buildAuthorizeUrl(state), 302);
    res.cookies.set(CTRADER_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/ctrader",
      maxAge: CTRADER_STATE_TTL_SEC,
    });
    return res;
  });
}
