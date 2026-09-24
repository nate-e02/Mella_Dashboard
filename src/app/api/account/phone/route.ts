import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { changePhoneSchema } from "@/lib/validation/schemas";
import { changePhone } from "@/lib/services/phoneAuth";
import { formatPhone } from "@/lib/phone";

/** Confirms a new (or not yet verified) phone number with its CHANGE_PHONE code. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const sessionUser = await requireUser();
    const { phone, code } = changePhoneSchema.parse(await req.json());
    const result = await changePhone(sessionUser.id, sessionUser.sessionId, phone, code);
    return NextResponse.json({ ok: true, phone: formatPhone(result.phone) });
  });
}
