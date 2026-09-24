import { NextRequest, NextResponse } from "next/server";
import { mfaCodeSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { clearMfaChallenge, readMfaChallenge } from "@/lib/auth/session";
import { completeMfaLogin } from "@/lib/services/auth";

/** Second login step: exchanges the short-lived MFA challenge cookie + a TOTP/backup code for a session. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { code } = mfaCodeSchema.parse(await req.json());
    const userId = await readMfaChallenge();
    if (!userId) return NextResponse.json({ error: "Login again to continue" }, { status: 401 });

    const result = await completeMfaLogin(userId, code);
    if (result.outcome !== "SESSION") {
      return NextResponse.json({ error: "Invalid authentication code" }, { status: 401 });
    }
    await clearMfaChallenge();
    return NextResponse.json({ id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role });
  });
}
