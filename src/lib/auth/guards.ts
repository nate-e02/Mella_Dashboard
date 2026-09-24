import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { devOverridesEnabled } from "@/env";
import { AuthError, ConflictError } from "@/lib/errors";

export { AuthError, ConflictError };

/** Throws AuthError if there is no authenticated, active user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Not authenticated", 401);
  return user;
}

/** True when admins must have TOTP enabled to use admin functions. Always on in production. */
export function adminMfaRequired(): boolean {
  if (process.env.ADMIN_MFA_REQUIRED === "false") return false;
  return process.env.NODE_ENV === "production" || process.env.ADMIN_MFA_REQUIRED === "true";
}

/** Throws AuthError if the authenticated user is not an ADMIN (with MFA where required). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("Forbidden", 403);
  if (adminMfaRequired() && !user.mfaEnabled) {
    throw new AuthError("Multi-factor authentication must be enabled for admin access", 403, "MFA_REQUIRED");
  }
  return user;
}

/** Throws AuthError if the authenticated user is not a TRADER. */
export async function requireTrader(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "TRADER") throw new AuthError("Forbidden", 403);
  return user;
}

/**
 * Development-only actions (KYC override, mark-paid, simulated trades) are
 * hidden with a 404 unless ENABLE_DEV_OVERRIDES=true outside production.
 */
export function assertDevOverridesEnabled(): void {
  if (!devOverridesEnabled()) throw new AuthError("Not found", 404);
}

/**
 * Wraps a route handler body, converting known error shapes into safe JSON
 * responses. Never forwards a raw error message for errors we don't
 * recognize: only our own typed errors (AuthError, ConflictError, trimmed Zod
 * issues) or a small allowlist of Prisma error codes get a specific, still
 * generic message; everything else is logged server-side and returned as an
 * opaque 500.
 */
export async function withApiErrorHandling(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown }).issues)) {
      const issues = (err as { issues: { path?: (string | number)[]; message?: string }[] }).issues.map((i) => ({
        path: (i.path ?? []).join("."),
        message: i.message ?? "Invalid value",
      }));
      return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      console.error("Prisma validation error:", err.message.split("\n")[0]);
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return prismaErrorResponse(err);
    }
    console.error("Unhandled API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function prismaErrorResponse(err: Prisma.PrismaClientKnownRequestError): NextResponse {
  switch (err.code) {
    case "P2025":
      console.error("Prisma record-not-found error:", err.code);
      return NextResponse.json({ error: "The requested resource was not found" }, { status: 404 });
    case "P2002":
      console.error("Prisma unique-constraint error on", err.meta?.target);
      return NextResponse.json({ error: "A conflicting record already exists" }, { status: 409 });
    case "P2003":
      console.error("Prisma foreign-key error on", err.meta?.field_name);
      return NextResponse.json({ error: "This action is blocked because the record is referenced elsewhere" }, { status: 409 });
    default:
      console.error("Unhandled Prisma error:", err.code);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
