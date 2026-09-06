import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createUser, listUsers } from "@/lib/services/users";
import { createUserSchema, paginationSchema } from "@/lib/validation/schemas";
import type { Role, UserStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const role = (searchParams.get("role") as Role | "ALL") ?? "ALL";
    const status = (searchParams.get("status") as UserStatus | "ALL") ?? "ALL";

    const result = await listUsers({ search, role, status, page, pageSize });
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const data = createUserSchema.parse(body);
    // Errors (duplicate email -> ConflictError, or a raced unique-constraint
    // violation -> Prisma P2002) are handled centrally by
    // withApiErrorHandling, which maps both to a safe 409 without leaking
    // any raw database error details.
    const user = await createUser(data, admin.id);
    return NextResponse.json(user, { status: 201 });
  });
}
