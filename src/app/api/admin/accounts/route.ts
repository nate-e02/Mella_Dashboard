import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createAccountForUser, listAccounts } from "@/lib/services/accounts";
import { paginationSchema } from "@/lib/validation/schemas";
import type { AccountStatus } from "@prisma/client";
import { z } from "zod";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = (searchParams.get("status") as AccountStatus | "ALL") ?? "ALL";

    const result = await listAccounts({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}

const createAccountSchema = z.object({
  userId: z.string().min(1),
  templateId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const { userId, templateId } = createAccountSchema.parse(body);
    const account = await createAccountForUser(userId, templateId, admin.id);
    return NextResponse.json(account, { status: 201 });
  });
}
