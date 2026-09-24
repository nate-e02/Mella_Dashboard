import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import type { Prisma, Role, UserStatus } from "@prisma/client";

/**
 * Sessions are server-side rows; the cookie carries a signed JWT holding only
 * the opaque session id. Role/status/MFA state are re-read from the database
 * on every request, so disabling or demoting a user takes effect immediately.
 */

const BASE_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "mellafx_session";
const MFA_COOKIE_NAME = "mellafx_mfa";

/** Absolute lifetime per role. */
const SESSION_TTL_MS: Record<Role, number> = {
  ADMIN: 12 * 60 * 60 * 1000,
  TRADER: 7 * 24 * 60 * 60 * 1000,
};
/** Inactivity timeout per role (measured on server requests, throttled writes). */
const IDLE_TIMEOUT_MS: Record<Role, number> = {
  ADMIN: 30 * 60 * 1000,
  TRADER: 12 * 60 * 60 * 1000,
};
const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function isSecureContext(): boolean {
  return process.env.NODE_ENV === "production" || (process.env.APP_URL ?? "").startsWith("https://");
}

/** `__Host-` prefix binds the cookie to this exact host over HTTPS (no subdomain tossing). */
export function sessionCookieName(): string {
  const base = BASE_COOKIE_NAME.replace(/^__Host-/, "");
  return isSecureContext() ? `__Host-${base}` : base;
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  mfaEnabled: boolean;
  emailVerifiedAt: Date | null;
  sessionId: string;
};

export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null; requestId: string | null }> {
  try {
    const h = await headers();
    const ip = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null, requestId: h.get("x-request-id") };
  } catch {
    return { ip: null, userAgent: null, requestId: null };
  }
}

export async function createSession(userId: string, role: Role) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS[role]);
  const ctx = await requestContext();
  const session = await prisma.session.create({
    data: { userId, expiresAt, ip: ctx.ip, userAgent: ctx.userAgent },
  });

  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureContext(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return session;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      const sid = payload.sid as string | undefined;
      if (sid) {
        await prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    } catch {
      // ignore invalid token on logout
    }
  }
  cookieStore.delete(sessionCookieName());
}

/**
 * Resolves the current user from the session cookie. Wrapped in React
 * `cache()` so a layout and a page in the same request share one lookup.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return null;

  let sid: string | undefined;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    sid = payload.sid as string | undefined;
  } catch {
    return null;
  }
  if (!sid) return null;

  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: true } });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (session.user.status !== "ACTIVE") return null;

  const idle = now - session.lastSeenAt.getTime();
  if (idle > IDLE_TIMEOUT_MS[session.user.role]) {
    await prisma.session.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }

  if (idle > LAST_SEEN_WRITE_INTERVAL_MS) {
    // Throttled: at most one write per 5 minutes per session, not one per request.
    void prisma
      .$transaction([
        prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date() } }),
        prisma.user.update({ where: { id: session.user.id }, data: { lastActivityAt: new Date() } }),
      ])
      .catch((err) => console.error("session touch failed:", err instanceof Error ? err.message : err));
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    phone: session.user.phone,
    role: session.user.role,
    status: session.user.status,
    mfaEnabled: session.user.mfaEnabled,
    emailVerifiedAt: session.user.emailVerifiedAt,
    sessionId: session.id,
  };
});

export async function revokeAllSessionsForUser(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  opts: { exceptSessionId?: string } = {},
) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// MFA challenge: a short-lived pre-session cookie set after a correct password
// for a user with MFA enabled; exchanged for a real session by /api/auth/mfa/verify.
// ---------------------------------------------------------------------------

export async function createMfaChallenge(userId: string) {
  const token = await new SignJWT({ sub: userId, purpose: "mfa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getSecret());
  const cookieStore = await cookies();
  cookieStore.set(MFA_COOKIE_NAME, token, { httpOnly: true, secure: isSecureContext(), sameSite: "lax", path: "/", maxAge: 300 });
}

export async function readMfaChallenge(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MFA_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.purpose === "mfa" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function clearMfaChallenge() {
  const cookieStore = await cookies();
  cookieStore.delete(MFA_COOKIE_NAME);
}

/** Deletes sessions that are expired, or revoked more than 7 days ago. Run by the worker hourly. */
export async function cleanupExpiredSessions(): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: weekAgo } }] },
  });
  return result.count;
}
