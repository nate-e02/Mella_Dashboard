import { NextRequest, NextResponse } from "next/server";
import { adminMfaRequired, requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { mfaDisableSchema } from "@/lib/validation/schemas";
import { disableMfa } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const { password, code } = mfaDisableSchema.parse(await req.json());
    await disableMfa(user.id, password, code, { allowForAdmins: !adminMfaRequired() });
    return NextResponse.json({ ok: true });
  });
}
