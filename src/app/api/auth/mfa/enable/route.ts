import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { mfaCodeSchema } from "@/lib/validation/schemas";
import { confirmMfaEnrolment } from "@/lib/services/auth";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const { code } = mfaCodeSchema.parse(await req.json());
    const result = await confirmMfaEnrolment(user.id, code);
    return NextResponse.json(result);
  });
}
