import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/services/audit";

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const sessionUser = await requireUser();
    const body = await req.json();
    const data = changePasswordSchema.parse(body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });
    const valid = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const passwordHash = await hashPassword(data.newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await logAudit({ actorId: user.id, action: "PASSWORD_CHANGED", targetType: "User", targetId: user.id });

    return NextResponse.json({ ok: true });
  });
}
