import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createEconomicEvent, getNewsWindowMinutes, importEventsCsv, listEconomicEvents, parseEventTime, setNewsWindowMinutes } from "@/lib/services/newsCalendar";

/** Admin economic calendar: list upcoming/past events (with the current ± window). */
export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const scope = sp.get("scope") === "past" ? "past" : "upcoming";
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 25));
    const [list, windowMinutes] = await Promise.all([listEconomicEvents({ scope, page, pageSize }), getNewsWindowMinutes()]);
    return NextResponse.json({ ...list, windowMinutes });
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(200),
    currency: z.string().trim().length(3),
    impact: z.enum(["LOW", "MEDIUM", "HIGH"]),
    scheduledAt: z.string().refine((v) => parseEventTime(v) !== null, "ISO-8601 date-time with offset required"),
  }),
  z.object({ action: z.literal("import"), csv: z.string().min(1).max(500_000) }),
  z.object({ action: z.literal("setWindow"), minutes: z.number().min(0).max(120) }),
]);

/** Create one event, bulk-import CSV, or set the news window (all audited). */
export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = actionSchema.parse(await req.json());
    switch (body.action) {
      case "create": {
        const row = await createEconomicEvent({ title: body.title, currency: body.currency, impact: body.impact, scheduledAt: parseEventTime(body.scheduledAt)! }, admin.id);
        return NextResponse.json(row, { status: 201 });
      }
      case "import":
        return NextResponse.json(await importEventsCsv(body.csv, admin.id));
      case "setWindow":
        return NextResponse.json({ windowMinutes: await setNewsWindowMinutes(body.minutes, admin.id) });
    }
  });
}
