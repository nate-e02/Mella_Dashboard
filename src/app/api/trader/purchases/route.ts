import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ConflictError, requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { initiateChapaPurchase, listPurchasesForUser } from "@/lib/services/purchases";
import { initiatePurchaseSchema } from "@/lib/validation/schemas";

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
    // Note: initiatePurchaseSchema has no `amount` field - even if a client
    // sends one, it is silently dropped by Zod and never reaches the
    // service layer. The charged amount always comes from the template's
    // current database price inside initiateChapaPurchase().
    const data = initiatePurchaseSchema.parse(body);
    try {
      const result = await initiateChapaPurchase(user, data.templateId, data.idempotencyKey);
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      // Let recognized error shapes (state conflicts, Prisma errors) fall
      // through to the shared handler for a consistent, safe response -
      // only the plain business-rule messages thrown directly by
      // initiateChapaPurchase are meant to be shown to the trader as-is.
      if (err instanceof ConflictError || err instanceof Prisma.PrismaClientKnownRequestError) throw err;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Purchase failed" }, { status: 400 });
    }
  });
}
