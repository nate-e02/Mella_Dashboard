import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const body = await req.json();
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const valid = await verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (user.status === "DISABLED") {
      return NextResponse.json({ error: "This account has been disabled. Contact an administrator." }, { status: 403 });
    }

    await createSession(user.id);

    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });
}
