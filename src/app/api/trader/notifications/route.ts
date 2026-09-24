import { NextRequest, NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { listNotificationsForUser, markNotificationsRead } from "@/lib/services/notifications";
import { z } from "zod";

export async function GET() {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    return NextResponse.json(await listNotificationsForUser(user.id));
  });
}

const readSchema = z.object({ ids: z.array(z.string().min(1)).max(100).optional() });

export async function PATCH(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireUser();
    const { ids } = readSchema.parse(await req.json().catch(() => ({})));
    await markNotificationsRead(user.id, ids);
    return NextResponse.json({ ok: true });
  });
}
