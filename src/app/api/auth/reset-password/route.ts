import { NextRequest, NextResponse } from "next/server";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { resetPassword } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { token, password } = resetPasswordSchema.parse(await req.json());
    const ok = await resetPassword(token, password);
    if (!ok) return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}
