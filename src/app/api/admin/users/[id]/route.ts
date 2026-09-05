import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { getUserDetail, updateUser } from "@/lib/services/users";
import { updateUserSchema } from "@/lib/validation/schemas";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const user = await getUserDetail(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json(user);
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json();
    const data = updateUserSchema.parse(body);
    const updated = await updateUser(id, data, admin.id);
    return NextResponse.json(updated);
  });
}
