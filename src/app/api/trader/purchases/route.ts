import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { createDemoPurchase, listPurchasesForUser } from "@/lib/services/purchases";
import { demoPurchaseSchema } from "@/lib/validation/schemas";

export async function GET() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const purchases = await listPurchasesForUser(user.id);
    return NextResponse.json(purchases);
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const body = await req.json();
    const data = demoPurchaseSchema.parse(body);
    try {
      const result = await createDemoPurchase(user.id, data.templateId, data.amount);
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Purchase failed" }, { status: 400 });
    }
  });
}
