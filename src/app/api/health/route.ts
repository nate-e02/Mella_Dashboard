import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for load balancers and uptime monitors. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up", latencyMs: Date.now() - startedAt, version: process.env.APP_VERSION ?? "dev" });
  } catch (err) {
    console.error("health check: database unreachable:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
