import { NextResponse } from "next/server";
import { destroySession, getSessionUser } from "@/lib/auth/session";
import { logAudit } from "@/lib/services/audit";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: true });
  await destroySession();
  await logAudit({ actorId: user.id, action: "LOGOUT", targetType: "User", targetId: user.id });
  return NextResponse.json({ ok: true });
}
