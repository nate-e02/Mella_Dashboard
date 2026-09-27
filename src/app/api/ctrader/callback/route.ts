import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { appUrl } from "@/env";
import { logAudit } from "@/lib/services/audit";
import { chooseAccount, exchangeAuthorizationCode, listTradingAccounts, saveStoredCTraderAuth } from "@/lib/services/ctraderAuth";
import { CTRADER_STATE_COOKIE } from "@/lib/services/ctraderOAuthCookie";

export const dynamic = "force-dynamic";

function back(result: string): NextResponse {
  const res = NextResponse.redirect(`${appUrl()}/admin/trading-engine?ctrader=${encodeURIComponent(result)}`, 302);
  res.cookies.set(CTRADER_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/ctrader", maxAge: 0 });
  return res;
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * cTrader OAuth redirect target (CTRADER_REDIRECT_URI). Only completes for the
 * signed-in admin who started the flow in this browser (state cookie), then
 * exchanges the one-time code, picks the trading account and stores the
 * tokens encrypted. The trading worker picks them up within 30 seconds.
 */
export async function GET(req: NextRequest) {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch {
    return NextResponse.redirect(`${appUrl()}/login?next=/admin/trading-engine`, 302);
  }
  const params = req.nextUrl.searchParams;
  const expected = req.cookies.get(CTRADER_STATE_COOKIE)?.value;
  const returned = params.get("state");
  if (!expected || (returned && !sameState(returned, expected))) return back("state_mismatch");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code || code.length > 512) return back("missing_code");

  try {
    const tokens = await exchangeAuthorizationCode(code);
    const accounts = await listTradingAccounts(tokens.accessToken);
    const account = chooseAccount(accounts);
    if (!account) return back("no_account");
    await saveStoredCTraderAuth(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        accountId: account.ctidTraderAccountId,
        isLive: account.isLive,
        traderLogin: account.traderLogin,
        connectedAt: new Date().toISOString(),
        refreshedAt: null,
      },
      adminId,
    );
    await logAudit({
      actorId: adminId,
      action: "CTRADER_CONNECTED",
      targetType: "SystemSetting",
      targetId: "ctrader.oauth",
      after: { accountId: account.ctidTraderAccountId, isLive: account.isLive, accounts: accounts.length },
    });
    return back("connected");
  } catch (err) {
    console.error("ctrader oauth callback failed:", err instanceof Error ? err.message : err);
    await logAudit({ actorId: adminId, action: "CTRADER_CONNECT_FAILED", targetType: "SystemSetting", targetId: "ctrader.oauth" }).catch(() => undefined);
    return back("failed");
  }
}
