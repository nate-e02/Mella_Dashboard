import { NextRequest } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { requestContext } from "@/lib/auth/session";
import { otpRequestResponse } from "@/lib/auth/otpHttp";
import { accountOtpRequestSchema } from "@/lib/validation/schemas";
import { requestAccountOtp } from "@/lib/services/phoneAuth";

/** Texts a code for an account change: a new phone number (CHANGE_PHONE) or a first password (SET_PASSWORD). */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const data = accountOtpRequestSchema.parse(await req.json());
    const { ip } = await requestContext();
    return otpRequestResponse(await requestAccountOtp(user.id, data, { ip }));
  });
}
