import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { workerRequest } from "@/lib/services/settings";
import { logAudit } from "@/lib/services/audit";
import { z } from "zod";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const status = await workerRequest<unknown>("/status");
    return NextResponse.json({ reachable: status.ok, status: status.data });
  });
}

const actionSchema = z.object({ action: z.enum(["halt", "resume", "reload-account"]), accountId: z.string().optional() });

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { action, accountId } = actionSchema.parse(await req.json());
    const path = action === "reload-account" ? "/internal/reload-account" : `/internal/${action}`;
    const result = await workerRequest<unknown>(path, { method: "POST", body: accountId ? { accountId } : {} });
    await logAudit({ actorId: admin.id, action: `ENGINE_${action.toUpperCase().replace("-", "_")}`, targetType: "TradingEngine", targetId: accountId ?? null, after: { ok: result.ok } });
    if (!result.ok) return NextResponse.json({ error: "Trading worker is not reachable" }, { status: 502 });
    return NextResponse.json({ ok: true, result: result.data });
  });
}
