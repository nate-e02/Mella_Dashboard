import { NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const accounts = await prisma.tradingAccount.findMany({
      where: { status: "FUNDED" },
      select: { id: true, balance: true, startingBalance: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(accounts);
  });
}
