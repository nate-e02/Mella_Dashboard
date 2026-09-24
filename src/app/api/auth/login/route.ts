import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { loginWithPassword } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const data = loginSchema.parse(await req.json());
    const result = await loginWithPassword(data.email, data.password);

    switch (result.outcome) {
      case "INVALID":
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      case "DISABLED":
        return NextResponse.json({ error: "This account has been disabled. Contact support." }, { status: 403 });
      case "MFA_REQUIRED":
        return NextResponse.json({ mfaRequired: true });
      case "SESSION":
        return NextResponse.json({
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
          emailVerified: !!result.user.emailVerifiedAt,
          mfaEnabled: result.user.mfaEnabled,
        });
    }
  });
}
