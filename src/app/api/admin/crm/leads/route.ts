import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withApiErrorHandling } from "@/lib/auth/guards";
import { createLead, listLeads } from "@/lib/services/crm";
import { leadSchema, paginationSchema } from "@/lib/validation/schemas";
import type { LeadStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  return withApiErrorHandling(async () => {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const { page, pageSize, search } = paginationSchema.parse(Object.fromEntries(searchParams));
    const status = (searchParams.get("status") as LeadStatus | "ALL") ?? "ALL";
    const result = await listLeads({ search, status, page, pageSize });
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const admin = await requireAdmin();
    const body = await req.json();
    const data = leadSchema.parse(body);
    const lead = await createLead(data, admin.id);
    return NextResponse.json(lead, { status: 201 });
  });
}
