import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { registerSchema } from "@/lib/validation/schemas";
import { withApiErrorHandling } from "@/lib/auth/guards";
import { logAudit } from "@/lib/services/audit";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const body = await req.json();
    const data = registerSchema.parse(body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, passwordHash, role: "TRADER" },
    });

    await logAudit({ actorId: user.id, action: "USER_REGISTERED", targetType: "User", targetId: user.id });
    await createSession(user.id);

    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });
}
