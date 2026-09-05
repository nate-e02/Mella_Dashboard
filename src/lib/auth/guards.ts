import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
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

/** Wraps a route handler body, converting AuthError / ZodError into JSON responses. */
export async function withApiErrorHandling(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err && typeof err === "object" && "issues" in err) {
      return NextResponse.json(
        { error: "Validation failed", issues: (err as { issues: unknown }).issues },
        { status: 400 },
      );
    }
    console.error("Unhandled API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
