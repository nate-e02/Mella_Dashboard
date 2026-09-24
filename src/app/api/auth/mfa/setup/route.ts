import { NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { beginMfaEnrolment } from "@/lib/services/auth";

export async function POST() {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const enrolment = await beginMfaEnrolment(user.id);
    return NextResponse.json(enrolment);
  });
}
