import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { addEmailSchema } from "@/lib/validation/schemas";
import { addEmail } from "@/lib/services/phoneAuth";

/**
 * Adds an email to an account without one (phone sign-ups). Same answer
 * whether or not the address was free, so it cannot be used to look up
 * other customers' emails.
 */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const { email } = addEmailSchema.parse(await req.json());
    await addEmail(user.id, email);
    return NextResponse.json({ ok: true });
  });
}
