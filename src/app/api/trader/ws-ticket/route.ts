import { wsPublicUrl } from "@/env";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";

export const DEFAULT_WS_URL = "ws://localhost:4100/ws";
const TICKET_TTL_SECONDS = 60;

/**
 * Mints a short-lived, single-purpose JWT the browser presents when opening
 * the trading WebSocket (`${wsUrl}?ticket=...`). The session cookie itself is
 * never sent to the worker; the ticket carries only the user id/role and a
 * `purpose: "ws"` claim so it cannot be replayed as a session token.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");

    const ticket = await new SignJWT({ role: user.role, purpose: "ws" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
      .sign(new TextEncoder().encode(secret));

    return NextResponse.json(
      { ticket, wsUrl: wsPublicUrl(), expiresIn: TICKET_TTL_SECONDS },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
