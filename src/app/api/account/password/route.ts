import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { setPasswordSchema } from "@/lib/validation/schemas";
import { setInitialPassword } from "@/lib/services/phoneAuth";

/** Sets the first password on a phone-only account, proven by a SET_PASSWORD SMS code. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const sessionUser = await requireUser();
    const { code, newPassword } = setPasswordSchema.parse(await req.json());
    await setInitialPassword(sessionUser.id, sessionUser.sessionId, code, newPassword);
    return NextResponse.json({ ok: true });
  });
}
