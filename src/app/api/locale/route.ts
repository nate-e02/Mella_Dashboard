import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { LOCALES, LOCALE_COOKIE } from "@/i18n/config";

const schema = z.object({ locale: z.enum(LOCALES) });

/** Sets the UI language cookie (1 year) and remembers it on the user for SMS/email. */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const { locale } = schema.parse(await req.json());
    const user = await getSessionUser();
    if (user) await prisma.user.update({ where: { id: user.id }, data: { locale } });
    const res = NextResponse.json({ locale });
    res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", httpOnly: false, secure: process.env.NODE_ENV === "production" });
    return res;
  });
}
