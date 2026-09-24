import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { changePassword } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const sessionUser = await requireUser();
    const data = changePasswordSchema.parse(await req.json());
    await changePassword(sessionUser.id, sessionUser.sessionId, data.currentPassword, data.newPassword);
    return NextResponse.json({ ok: true });
  });
}
