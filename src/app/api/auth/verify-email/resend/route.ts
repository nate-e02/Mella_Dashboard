import { NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { sendEmailVerification } from "@/lib/services/auth";

export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    await sendEmailVerification(user.id);
    return NextResponse.json({ ok: true });
  });
}
