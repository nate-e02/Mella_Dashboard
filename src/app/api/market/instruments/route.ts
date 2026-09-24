import { NextResponse } from "next/server";
import { requireUser, withApiErrorHandling } from "@/lib/auth/guards";
import { listInstruments } from "@/lib/services/market";

/** Enabled instruments (any authenticated user). */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireUser();
    const instruments = await listInstruments();
    return NextResponse.json(instruments, { headers: { "Cache-Control": "private, max-age=60" } });
  });
}
