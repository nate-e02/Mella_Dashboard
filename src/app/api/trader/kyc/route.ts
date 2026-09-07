import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ConflictError, requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { startProviderVerification } from "@/lib/services/kycVerification";

/**
 * Starts (or resumes) a real KYC verification for the authenticated trader.
 * The authenticated user always comes from the server-side session - there
 * is no request body, so a client can never submit another user's id, a
 * privileged status, or any provider result as "proof" of verification.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    try {
      const result = await startProviderVerification(user);
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      // Let recognized error shapes (state conflicts, Prisma errors) fall
      // through to the shared handler for a consistent, safe response -
      // only the plain business-rule message thrown directly by
      // startProviderVerification (e.g. the provider isn't configured) is
      // meant to be shown to the trader as-is.
      if (err instanceof ConflictError || err instanceof Prisma.PrismaClientKnownRequestError) throw err;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Unable to start verification" }, { status: 400 });
    }
  });
}
