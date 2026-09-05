import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { createKycSubmission } from "@/lib/services/kyc";
import { z } from "zod";

const schema = z.object({
  fullName: z.string().min(2).max(150),
  country: z.string().min(2).max(100),
  documentType: z.string().min(2).max(100),
});

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const body = await req.json();
    const data = schema.parse(body);
    const submission = await createKycSubmission({ userId: user.id, ...data });
    return NextResponse.json(submission, { status: 201 });
  });
}
