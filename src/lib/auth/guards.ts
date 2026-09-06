import "server-only";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * A well-formed request that cannot be completed because of the current
 * state of the resource (e.g. refunding a purchase that isn't PAID, deciding
 * a payout that isn't PENDING). Distinct from validation errors (malformed
 * input) and from AuthError (who is allowed to act) - this is about whether
 * the requested state transition is currently legal.
 */
export class ConflictError extends Error {
  status = 409;
}

/** Throws AuthError if there is no authenticated, active user. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Not authenticated", 401);
  return user;
}

/** Throws AuthError if the authenticated user is not an ADMIN. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("Forbidden", 403);
  return user;
}

/** Throws AuthError if the authenticated user is not a TRADER. */
export async function requireTrader(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "TRADER") throw new AuthError("Forbidden", 403);
  return user;
}

/**
 * Wraps a route handler body, converting known error shapes into safe JSON
 * responses with appropriate status codes. Never forwards a raw error
 * message for errors we don't recognize - only our own typed errors
 * (AuthError, ConflictError, Zod validation issues) or a small allowlist of
 * Prisma error codes get a specific, still-generic message; everything else
 * is logged server-side and returned as an opaque 500 so stack traces,
 * database internals, and other implementation details never reach a
 * client.
 */
export async function withApiErrorHandling(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError || err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err && typeof err === "object" && "issues" in err) {
      return NextResponse.json(
        { error: "Validation failed", issues: (err as { issues: unknown }).issues },
        { status: 400 },
      );
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
    case "P2025": // record required for the operation was not found
      console.error("Prisma record-not-found error:", err.message);
      return NextResponse.json({ error: "The requested resource was not found" }, { status: 404 });
    case "P2002": // unique constraint violation
      console.error("Prisma unique-constraint error:", err.message, err.meta);
      return NextResponse.json({ error: "A conflicting record already exists" }, { status: 409 });
    case "P2003": // foreign key constraint violation
      console.error("Prisma foreign-key error:", err.message, err.meta);
      return NextResponse.json(
        { error: "This action is blocked because the record is referenced elsewhere" },
        { status: 409 },
      );
    default:
      console.error("Unhandled Prisma error:", err.code, err.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
