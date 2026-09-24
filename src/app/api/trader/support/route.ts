import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { supportTicketSchema } from "@/lib/validation/schemas";
import { createTicket, listTicketsForUser } from "@/lib/services/support";

export async function GET() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    return NextResponse.json(await listTicketsForUser(user.id));
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const { subject, message } = supportTicketSchema.parse(await req.json());
    return NextResponse.json(await createTicket(user.id, subject, message), { status: 201 });
  });
}
