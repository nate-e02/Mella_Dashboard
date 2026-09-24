import { NextRequest, NextResponse } from "next/server";
import { verifyEmailSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { verifyEmail } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { token } = verifyEmailSchema.parse(await req.json());
    const ok = await verifyEmail(token);
    if (!ok) return NextResponse.json({ error: "This verification link is invalid or has expired" }, { status: 400 });
    return NextResponse.json({ ok: true });
  });
}
