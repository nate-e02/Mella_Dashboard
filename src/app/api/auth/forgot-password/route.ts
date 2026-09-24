import { NextRequest, NextResponse } from "next/server";
import { forgotPasswordSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { requestPasswordReset } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { email } = forgotPasswordSchema.parse(await req.json());
    await requestPasswordReset(email);
    return NextResponse.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
  });
}
