import { NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { listAccountsForUser } from "@/lib/services/accounts";

export async function GET() {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const accounts = await listAccountsForUser(user.id);
    return NextResponse.json(accounts);
  });
}
